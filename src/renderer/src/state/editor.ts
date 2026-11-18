/**
 * The entry editor (entry-editing spec): loads the selected entry, keeps pending edits, and
 * saves them as one modify that only succeeds if the entry is unchanged on the server.
 */
import { create } from 'zustand'
import { changes, cleaned, validate, type Working } from '@renderer/editor/model'
import { keyOf } from '@renderer/tree/model'
import {
  escapeDnValue,
  isDescendantOf,
  parentDn as parentOf,
  parseDn,
  parseDnStrict,
  serializeDn,
} from '@shared/dn'
import type { Modification } from '@shared/entry'
import type { Entry } from '@shared/ipc'
import { NO_SCHEMA, useSchema } from './schema'
import { useTree } from './tree'

export interface OpenEntry {
  connectionId: string
  dn: string
  original: Working
  working: Working
  changeMarker: Entry['changeMarker']
  /** Set for an entry that does not exist yet (new or copied); saving creates it. */
  draft?: { parentDn: string; rdnAttribute: string; rdnValue: string }
}

type Target = { connectionId: string; dn: string }

interface EditorStore {
  status: 'empty' | 'loading' | 'ready' | 'missing' | 'error'
  entry: OpenEntry | undefined
  loadError: string | undefined
  includeOperational: boolean
  saving: boolean
  /** A server error from the last save; pending changes are kept. */
  saveError: string | undefined
  /** Problems that blocked the last save attempt, by attribute. */
  problems: Map<string, string>
  /** The entry changed on the server since it was loaded (assertion failed). */
  stale: boolean
  /** Where the user wanted to go while changes were pending. */
  guard: Target | undefined

  requestOpen: (connectionId: string, dn: string) => void
  open: (connectionId: string, dn: string) => Promise<void>
  close: () => void
  reload: () => Promise<void>
  setOperational: (include: boolean) => Promise<void>
  edit: (working: Working) => void
  discard: () => void
  pendingChanges: () => Modification[]
  /** Checks the schema rules; returns false (and sets `problems`) if saving is blocked. */
  check: () => boolean
  save: (options?: { overwrite?: boolean }) => Promise<boolean>
  /** Opens a not-yet-created entry in the editor; nothing is sent until it is saved. */
  startDraft: (draft: {
    connectionId: string
    parentDn: string
    rdnAttribute: string
    rdnValue: string
    working: Working
  }) => void
  resolveGuard: (choice: 'save' | 'discard' | 'stay') => Promise<Target | undefined>
}

const schemaFor = (connectionId: string) => (useSchema.getState().schemas[connectionId] ?? NO_SCHEMA).model

export const useEditor = create<EditorStore>((set, get) => ({
  status: 'empty',
  entry: undefined,
  loadError: undefined,
  includeOperational: false,
  saving: false,
  saveError: undefined,
  problems: new Map(),
  stale: false,
  guard: undefined,

  requestOpen(connectionId, dn) {
    const { entry } = get()
    if (entry && entry.connectionId === connectionId && entry.dn.toLowerCase() === dn.toLowerCase()) {
      return
    }
    if (entry && get().pendingChanges().length > 0) {
      set({ guard: { connectionId, dn } })
      return
    }
    void get().open(connectionId, dn)
  },

  async open(connectionId, dn) {
    set({ status: 'loading', guard: undefined, saveError: undefined, problems: new Map(), stale: false })
    const result = await window.api.invoke('entry.read', {
      connectionId,
      dn,
      includeOperational: get().includeOperational,
    })
    if (!result.ok) {
      set({ status: 'error', entry: undefined, loadError: result.error.message })
      return
    }
    if (result.value === null) {
      set({ status: 'missing', entry: undefined, loadError: undefined })
      return
    }
    const loaded = result.value
    set({
      status: 'ready',
      loadError: undefined,
      entry: {
        connectionId,
        dn: loaded.dn,
        original: loaded.attributes,
        working: loaded.attributes,
        changeMarker: loaded.changeMarker,
      },
    })
  },

  close() {
    set({
      status: 'empty',
      entry: undefined,
      guard: undefined,
      saveError: undefined,
      problems: new Map(),
      stale: false,
    })
  },

  async reload() {
    const { entry } = get()
    if (entry) {
      await get().open(entry.connectionId, entry.dn)
    }
  },

  async setOperational(include) {
    set({ includeOperational: include })
    const { entry } = get()
    if (entry && get().pendingChanges().length === 0) {
      await get().reload()
    }
  },

  edit(working) {
    const { entry } = get()
    if (entry) {
      set({ entry: { ...entry, working }, saveError: undefined })
      if (get().problems.size > 0) {
        set({ problems: validate(working, schemaFor(entry.connectionId)) })
      }
    }
  },

  discard() {
    const { entry } = get()
    if (entry) {
      set({
        entry: { ...entry, working: entry.original },
        saveError: undefined,
        problems: new Map(),
        stale: false,
      })
    }
  },

  pendingChanges() {
    const { entry } = get()
    return entry ? changes(entry.original, entry.working, schemaFor(entry.connectionId)) : []
  },

  check() {
    const { entry } = get()
    if (!entry) {
      return false
    }
    const problems = validate(entry.working, schemaFor(entry.connectionId))
    const draft = entry.draft
    if (draft) {
      // The RDN value names the entry, so it must stay among the attribute's values.
      const attribute = cleaned(entry.working).find(
        (candidate) => candidate.name.toLowerCase() === draft.rdnAttribute.toLowerCase(),
      )
      if (!attribute?.values.some((value) => value === draft.rdnValue)) {
        problems.set(
          draft.rdnAttribute,
          `${draft.rdnAttribute} must include "${draft.rdnValue}", the value in the entry's name.`,
        )
      }
    }
    set({ problems })
    return problems.size === 0
  },

  async save(options = {}) {
    const { entry } = get()
    const pending = get().pendingChanges()
    if (!entry || pending.length === 0) {
      return true
    }
    if (!get().check()) {
      return false
    }
    if (entry.draft) {
      return createDraft(entry)
    }
    set({ saving: true, saveError: undefined })
    const result = await window.api.invoke('entry.modify', {
      connectionId: entry.connectionId,
      dn: entry.dn,
      changes: pending,
      ...(entry.changeMarker && !options.overwrite ? { assert: entry.changeMarker } : {}),
    })
    set({ saving: false })
    if (result.ok) {
      set({ stale: false })
      await get().reload()
      return true
    }
    if (result.error.kind === 'ldap' && result.error.resultCode === 122) {
      set({ stale: true })
    } else {
      const { error } = result
      set({
        saveError:
          error.kind === 'ldap' && error.diagnostic
            ? `${error.message} (${error.diagnostic})`
            : error.message,
      })
    }
    return false
  },

  startDraft({ connectionId, parentDn, rdnAttribute, rdnValue, working }) {
    set({
      status: 'ready',
      loadError: undefined,
      guard: undefined,
      saveError: undefined,
      problems: new Map(),
      stale: false,
      entry: {
        connectionId,
        dn: `${rdnAttribute}=${escapeDnValue(rdnValue)},${parentDn}`,
        original: [],
        working,
        changeMarker: undefined,
        draft: { parentDn, rdnAttribute, rdnValue },
      },
    })
  },

  async resolveGuard(choice) {
    const target = get().guard
    if (!target) {
      return undefined
    }
    if (choice === 'stay') {
      set({ guard: undefined })
      return undefined
    }
    if (choice === 'save' && !(await get().save())) {
      set({ guard: undefined })
      return undefined
    }
    await get().open(target.connectionId, target.dn)
    return target
  },
}))

/** Creates a draft entry, then opens it normally and shows it in the tree. */
async function createDraft(entry: OpenEntry): Promise<boolean> {
  useEditor.setState({ saving: true, saveError: undefined })
  const result = await window.api.invoke('entry.add', {
    connectionId: entry.connectionId,
    dn: entry.dn,
    attributes: cleaned(entry.working),
  })
  useEditor.setState({ saving: false })
  if (!result.ok) {
    const { error } = result
    useEditor.setState({
      saveError:
        error.kind === 'ldap' && error.diagnostic ? `${error.message} (${error.diagnostic})` : error.message,
    })
    return false
  }
  await useEditor.getState().open(entry.connectionId, entry.dn)
  await showInTree(entry.connectionId, entry.dn)
  return true
}

/** Refreshes the entry's parent in the tree (if it is shown) and selects the entry. */
export async function showInTree(connectionId: string, dn: string): Promise<void> {
  const tree = useTree.getState()
  const parent = parentOf(parseDnStrict(dn))
  const parentKey = parent && parent.length > 0 ? keyOf(serializeDn(parent)) : undefined
  if (parentKey && tree.trees[connectionId]?.nodes[parentKey]) {
    tree.refresh(connectionId, parentKey)
  }
  await tree.reveal(connectionId, dn)
}

/**
 * Opens an entry in the editor, showing it in the tree when it is below one of the roots. With
 * `revealOnly`, an entry outside the tree is not opened. An entry that the tree cannot show,
 * such as one that no longer exists, is opened directly so the editor says what happened.
 */
export async function openEntry(connectionId: string, dn: string, revealOnly = false): Promise<void> {
  const tree = useTree.getState()
  const roots = tree.trees[connectionId]?.rootKeys ?? []
  const parsed = parseDn(dn)
  const inTree =
    parsed.ok &&
    roots.some((root) => {
      const rootDn = parseDn(tree.trees[connectionId]?.nodes[root]?.dn ?? '')
      return rootDn.ok && (keyOf(dn) === root || isDescendantOf(parsed.dn, rootDn.dn))
    })
  if (inTree && (await tree.reveal(connectionId, dn))) {
    return
  }
  if (!revealOnly) {
    useEditor.getState().requestOpen(connectionId, dn)
  }
}
