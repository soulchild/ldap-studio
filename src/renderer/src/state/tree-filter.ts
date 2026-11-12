/**
 * The tree filter of each connection (directory-tree spec: filter the tree): the form, and the
 * search it ran on the server below the selected entry.
 */
import { create } from 'zustand'
import type { FilterMatch, FilterOperator } from '@renderer/tree/quick-filter'

/** More matches than this are not useful in a tree; the user narrows the filter instead. */
export const MAX_MATCHES = 1000

export interface FilterForm {
  attribute: string
  operator: FilterOperator
  value: string
  /** The whole subtree of the selected entry, or only its children. */
  subtree: boolean
}

export interface AppliedFilter {
  base: string
  subtree: boolean
  filter: string
  status: 'running' | 'done' | 'stopped' | 'error'
  matches: FilterMatch[]
  sizeLimitReached: boolean
  incomplete: boolean
  error?: string
}

export const DEFAULT_FORM: FilterForm = { attribute: '', operator: 'contains', value: '', subtree: true }

interface TreeFilterStore {
  forms: Record<string, FilterForm>
  applied: Record<string, AppliedFilter | undefined>
  setForm: (connectionId: string, changes: Partial<FilterForm>) => void
  apply: (connectionId: string, base: string, filter: string) => Promise<void>
  clear: (connectionId: string) => void
}

const running = new Map<string, { run: number; cancel?: () => void }>()
let runs = 0

export const useTreeFilter = create<TreeFilterStore>((set, get) => {
  const update = (connectionId: string, change: (applied: AppliedFilter) => Partial<AppliedFilter>) =>
    set((store) => {
      const current = store.applied[connectionId]
      return current
        ? { applied: { ...store.applied, [connectionId]: { ...current, ...change(current) } } }
        : {}
    })
  const stop = (connectionId: string) => {
    running.get(connectionId)?.cancel?.()
    running.delete(connectionId)
  }

  return {
    forms: {},
    applied: {},

    setForm(connectionId, changes) {
      set((store) => ({
        forms: {
          ...store.forms,
          [connectionId]: { ...(store.forms[connectionId] ?? DEFAULT_FORM), ...changes },
        },
      }))
    },

    async apply(connectionId, base, filter) {
      stop(connectionId)
      const run = ++runs
      running.set(connectionId, { run })
      const subtree = (get().forms[connectionId] ?? DEFAULT_FORM).subtree
      set((store) => ({
        applied: {
          ...store.applied,
          [connectionId]: {
            base,
            subtree,
            filter,
            status: 'running',
            matches: [],
            sizeLimitReached: false,
            incomplete: false,
          },
        },
      }))
      const current = () => running.get(connectionId)?.run === run
      try {
        const started = await window.api.stream(
          'search.run',
          {
            connectionId,
            base,
            scope: subtree ? 'sub' : 'one',
            filter,
            attributes: ['objectClass'],
            sizeLimit: MAX_MATCHES,
          },
          (event) => {
            if (!current()) {
              return
            }
            switch (event.kind) {
              case 'page':
                update(connectionId, (applied) => ({
                  matches: applied.matches.concat(
                    event.data.entries.map((entry) => ({
                      dn: entry.dn,
                      objectClasses: (
                        entry.attributes.find((attribute) => attribute.name.toLowerCase() === 'objectclass')
                          ?.values ?? []
                      ).filter((value): value is string => typeof value === 'string'),
                    })),
                  ),
                }))
                break
              case 'done':
                running.delete(connectionId)
                update(connectionId, () => ({
                  status: 'done',
                  sizeLimitReached: event.data.sizeLimitReached,
                  incomplete: event.data.incomplete,
                }))
                break
              case 'error':
                running.delete(connectionId)
                update(connectionId, () =>
                  event.error.kind === 'cancelled'
                    ? { status: 'stopped' }
                    : { status: 'error', error: event.error.message },
                )
                break
            }
          },
        )
        if (current()) {
          running.set(connectionId, { run, cancel: started.cancel })
        } else {
          started.cancel()
        }
      } catch (error) {
        if (current()) {
          running.delete(connectionId)
          update(connectionId, () => ({
            status: 'error',
            error: (error as { message?: string }).message ?? 'The filter failed.',
          }))
        }
      }
    },

    clear(connectionId) {
      stop(connectionId)
      set((store) => ({ applied: { ...store.applied, [connectionId]: undefined } }))
    },
  }
})
