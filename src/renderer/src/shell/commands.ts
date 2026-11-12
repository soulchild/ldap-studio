/**
 * What the command palette offers (app-shell spec: command palette). Built from the current
 * state each time, so only commands that apply right now are listed.
 */
import { openSearch } from '@renderer/search/open'
import { useEntryActions, type EntryAction } from '@renderer/state/actions'
import { useConnections } from '@renderer/state/connections'
import { useEditor } from '@renderer/state/editor'
import { useLayout } from '@renderer/state/layout'
import { useSettings } from '@renderer/state/settings'
import { useTree } from '@renderer/state/tree'
import { useUi } from '@renderer/state/ui'
import { keyOf } from '@renderer/tree/model'
import { SHORTCUTS, type Shortcut } from './shortcuts'

export type CommandGroup = 'Navigate' | 'Entry' | 'Connections' | 'View'

export interface Command {
  id: string
  title: string
  group: CommandGroup
  /** Extra words the command is found by. */
  keywords?: string
  shortcut?: Shortcut
  run: () => void
}

const ENTRY_ACTIONS: { kind: EntryAction; title: string; keywords: string }[] = [
  { kind: 'create', title: 'New child entry…', keywords: 'add create' },
  { kind: 'copy', title: 'Copy entry…', keywords: 'duplicate clone' },
  { kind: 'rename', title: 'Rename entry…', keywords: 'modify dn rdn' },
  { kind: 'move', title: 'Move entry…', keywords: 'modify dn parent' },
  { kind: 'delete', title: 'Delete entry…', keywords: 'remove' },
]

export function buildCommands(): Command[] {
  const connections = useConnections.getState()
  const activeState = connections.activeProfileId
    ? connections.states[connections.activeProfileId]
    : undefined
  const connectionId = activeState?.status === 'connected' ? activeState.connectionId : undefined
  const editor = useEditor.getState()
  const entry = editor.entry
  const entryLive =
    entry !== undefined &&
    Object.values(connections.states).some(
      (state) => state.status === 'connected' && state.connectionId === entry.connectionId,
    )
  const pending = entry ? editor.pendingChanges().length : 0
  const commands: Command[] = []

  // Navigate
  if (connectionId) {
    commands.push(
      {
        id: 'go-to-dn',
        title: 'Go to DN…',
        group: 'Navigate',
        keywords: 'lookup jump open entry',
        shortcut: SHORTCUTS.dnLookup,
        run: () => useUi.getState().show('goToDn'),
      },
      {
        id: 'search',
        title: 'Open the search',
        group: 'Navigate',
        keywords: 'find ldap filter query',
        shortcut: SHORTCUTS.search,
        run: openSearch,
      },
      {
        id: 'filter-tree',
        title: 'Filter the tree',
        group: 'Navigate',
        keywords: 'quick search find',
        run: () =>
          // After the palette has closed and given the focus back.
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>('[aria-label="Filter value"]')?.focus(),
          ),
      },
    )
  }
  commands.push({
    id: 'log',
    title: 'Show the operation log',
    group: 'Navigate',
    keywords: 'history operations',
    run: () => useLayout.getState().showBottomTab('log'),
  })

  // Entry
  if (entry && !entry.draft && entryLive) {
    if (pending > 0) {
      commands.push(
        {
          id: 'save',
          title: 'Review and save changes…',
          group: 'Entry',
          shortcut: SHORTCUTS.save,
          run: () => useUi.getState().requestSave(),
        },
        {
          id: 'discard',
          title: 'Discard changes',
          group: 'Entry',
          keywords: 'revert undo',
          shortcut: SHORTCUTS.discard,
          run: () => useEditor.getState().discard(),
        },
      )
    }
    for (const action of ENTRY_ACTIONS) {
      commands.push({
        id: `entry-${action.kind}`,
        title: action.title,
        group: 'Entry',
        keywords: action.keywords,
        run: () =>
          useEntryActions
            .getState()
            .start({ kind: action.kind, connectionId: entry.connectionId, dn: entry.dn }),
      })
    }
    commands.push({
      id: 'refresh',
      title: 'Refresh entry in the tree',
      group: 'Entry',
      keywords: 'reload children',
      run: () => useTree.getState().refresh(entry.connectionId, keyOf(entry.dn)),
    })
    if (pending === 0) {
      commands.push({
        id: 'operational',
        title: editor.includeOperational ? 'Hide operational attributes' : 'Show operational attributes',
        group: 'Entry',
        keywords: 'createTimestamp modifyTimestamp entryUUID',
        run: () => void useEditor.getState().setOperational(!editor.includeOperational),
      })
    }
  }
  if (entry && !entry.draft) {
    commands.push({
      id: 'copy-dn',
      title: 'Copy DN',
      group: 'Entry',
      keywords: 'clipboard distinguished name',
      run: () => void window.api.invoke('clipboard.writeText', { text: entry.dn }),
    })
  }
  if (entry?.draft && entryLive) {
    commands.push({
      id: 'create',
      title: 'Create the new entry',
      group: 'Entry',
      shortcut: SHORTCUTS.save,
      run: () => useUi.getState().requestSave(),
    })
  }

  // Connections
  commands.push({
    id: 'new-connection',
    title: 'New connection…',
    group: 'Connections',
    keywords: 'profile add server',
    run: () => useUi.getState().requestNewConnection(),
  })
  for (const profile of connections.profiles) {
    const state = connections.states[profile.id]
    const connected = state?.status === 'connected' || state?.status === 'connecting'
    commands.push({
      id: `connection-${profile.id}`,
      title: connected ? `Disconnect from ${profile.name}` : `Connect to ${profile.name}`,
      group: 'Connections',
      keywords: `${profile.host} profile server`,
      run: () => {
        useConnections.getState().setActive(profile.id)
        void (connected ? connections.disconnect(profile.id) : connections.connect(profile.id))
      },
    })
  }

  // View
  const theme = useSettings.getState().settings?.theme
  for (const [mode, title] of [
    ['system', 'Theme: match system'],
    ['light', 'Theme: light'],
    ['dark', 'Theme: dark'],
  ] as const) {
    if (theme !== mode) {
      commands.push({
        id: `theme-${mode}`,
        title,
        group: 'View',
        keywords: 'appearance color mode',
        run: () => useSettings.getState().update({ theme: mode }),
      })
    }
  }
  commands.push({
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    group: 'View',
    keywords: 'help keys',
    shortcut: SHORTCUTS.help,
    run: () => useUi.getState().show('shortcuts'),
  })
  return commands
}

/** Commands whose title, group or keywords contain every word typed, ignoring case. */
export function matchCommands(commands: readonly Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return [...commands]
  }
  const scored = commands
    .map((command) => {
      const title = command.title.toLowerCase()
      const text = `${title} ${command.group.toLowerCase()} ${command.keywords?.toLowerCase() ?? ''}`
      if (!words.every((word) => text.includes(word))) {
        return undefined
      }
      // Titles that start with the first word come first, then titles containing it.
      const first = words[0] ?? ''
      return { command, score: title.startsWith(first) ? 0 : title.includes(first) ? 1 : 2 }
    })
    .filter((item): item is { command: Command; score: number } => item !== undefined)
  return scored.sort((a, b) => a.score - b.score).map((item) => item.command)
}
