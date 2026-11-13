/** The search view (directory-search spec): parameters, streamed results, status and sorting. */
import { create } from 'zustand'
import { parseAttributeList } from '@renderer/search/assist'
import { parseFilter } from '@shared/filter'
import type { SearchEntry, SearchScope } from '@shared/ipc'

export interface SearchParams {
  base: string
  scope: SearchScope
  filter: string
  /** Comma- or space-separated attribute names; empty returns all user attributes. */
  attributes: string
  sizeLimit: string
}

export type SearchStatus =
  | { state: 'idle' }
  | { state: 'running'; queued: boolean }
  | { state: 'done'; incomplete: boolean; sizeLimitReached: boolean }
  | { state: 'stopped' }
  | { state: 'error'; message: string }

export interface SortOrder {
  column: string
  direction: 'ascending' | 'descending'
}

export const DEFAULT_SIZE_LIMIT = '1000'

interface SearchStore {
  params: SearchParams
  connectionId: string | undefined
  results: SearchEntry[]
  /** The attribute columns of the current results. */
  columns: string[]
  status: SearchStatus
  sort: SortOrder | undefined
  setParams: (changes: Partial<SearchParams>) => void
  run: (connectionId: string) => Promise<void>
  stop: () => void
  setSort: (column: string) => void
}

let cancel: (() => void) | undefined
/** Identifies the current search; events of a stopped or replaced search are ignored. */
let activeRun = 0

export const useSearch = create<SearchStore>((set, get) => ({
  params: { base: '', scope: 'sub', filter: '', attributes: '', sizeLimit: DEFAULT_SIZE_LIMIT },
  connectionId: undefined,
  results: [],
  columns: [],
  status: { state: 'idle' },
  sort: undefined,

  setParams(changes) {
    set((store) => ({ params: { ...store.params, ...changes } }))
  },

  async run(connectionId) {
    const { params } = get()
    if (!parseFilter(params.filter).ok) {
      return
    }
    cancel?.()
    cancel = undefined
    const run = ++activeRun
    const attributes = parseAttributeList(params.attributes)
    const sizeLimit = Math.max(0, Number.parseInt(params.sizeLimit, 10) || 0)
    set({
      connectionId,
      results: [],
      columns: attributes.filter((name) => !['*', '+', '1.1'].includes(name)),
      status: { state: 'running', queued: false },
      sort: undefined,
    })
    try {
      const started = await window.api.stream(
        'search.run',
        {
          connectionId,
          base: params.base,
          scope: params.scope,
          filter: params.filter,
          attributes,
          sizeLimit,
        },
        (event) => {
          // Stopped or replaced: whatever is still in flight must not change the view.
          if (run !== activeRun) {
            return
          }
          switch (event.kind) {
            case 'page':
              set((store) => ({ results: store.results.concat(event.data.entries) }))
              break
            case 'progress':
              set({
                status: { state: 'running', queued: event.data.queued === true && event.data.loaded === 0 },
              })
              break
            case 'done':
              activeRun++
              set({
                status: {
                  state: 'done',
                  incomplete: event.data.incomplete,
                  sizeLimitReached: event.data.sizeLimitReached,
                },
              })
              break
            case 'error':
              activeRun++
              set({
                status:
                  event.error.kind === 'cancelled'
                    ? { state: 'stopped' }
                    : { state: 'error', message: event.error.message },
              })
              break
          }
        },
      )
      if (run === activeRun) {
        cancel = started.cancel
      } else {
        // Stopped while the search was starting.
        started.cancel()
      }
    } catch (error) {
      if (run !== activeRun) {
        return
      }
      set({
        status: { state: 'error', message: (error as { message?: string }).message ?? 'The search failed.' },
      })
    }
  },

  stop() {
    activeRun++
    set({ status: { state: 'stopped' } })
    cancel?.()
    cancel = undefined
  },

  setSort(column) {
    set((store) => ({
      sort:
        store.sort?.column === column
          ? { column, direction: store.sort.direction === 'ascending' ? 'descending' : 'ascending' }
          : { column, direction: 'ascending' },
    }))
  },
}))
