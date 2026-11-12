/**
 * Paged searches (design §5). OpenLDAP keeps one paged-results state per connection, so each
 * session runs its paged operations one at a time through a `PagedQueue`. Pages are handed
 * to the caller as they arrive; size and admin limits end the search with partial results.
 */
import type { Client } from 'ldapts'
import type { SearchEntry, SearchScope } from '@shared/ipc'
import { isLimitResult } from './errors'
import { decodeEntry, EveryAttribute, type IsBinary, type RawEntry } from './values'

export const PAGED_RESULTS_OID = '1.2.840.113556.1.4.319'
const DEFAULT_PAGE_SIZE = 500

export class CancelledError extends Error {
  constructor() {
    super('The operation was cancelled.')
  }
}

interface QueuedTask {
  start: () => void
  signal: AbortSignal | undefined
  onAbort: () => void
}

/** Runs tasks one at a time in FIFO order. A task cancelled while queued never starts. */
export class PagedQueue {
  private running = false
  private readonly waiting: QueuedTask[] = []

  get pending(): number {
    return this.waiting.length
  }

  async run<T>(
    task: () => Promise<T>,
    options: { signal?: AbortSignal; onQueued?: () => void } = {},
  ): Promise<T> {
    const { signal } = options
    if (signal?.aborted) {
      throw new CancelledError()
    }
    if (this.running) {
      options.onQueued?.()
      await new Promise<void>((resolve, reject) => {
        const queued: QueuedTask = {
          start: () => {
            signal?.removeEventListener('abort', queued.onAbort)
            resolve()
          },
          signal,
          onAbort: () => {
            this.waiting.splice(this.waiting.indexOf(queued), 1)
            reject(new CancelledError())
          },
        }
        signal?.addEventListener('abort', queued.onAbort, { once: true })
        this.waiting.push(queued)
      })
    }
    this.running = true
    try {
      return await task()
    } finally {
      // Hand the queue straight to the next task instead of marking it idle in between.
      const next = this.waiting.shift()
      if (next) {
        next.start()
      } else {
        this.running = false
      }
    }
  }
}

export interface PagedSearchRequest {
  base: string
  scope: SearchScope
  filter: string
  attributes: string[]
  /** Maximum number of entries to return; 0 for no limit. */
  sizeLimit: number
  pageSize?: number
}

export interface PagedSearchResult {
  /** Fewer entries than exist: cancelled, size limit reached, or a server limit hit. */
  incomplete: boolean
  sizeLimitReached: boolean
  cancelled: boolean
  total: number
}

export interface PagedSearchOptions {
  supportsPaging: boolean
  isBinary: IsBinary
  onPage: (entries: SearchEntry[]) => void
  signal?: AbortSignal | undefined
}

const SCOPES = { base: 'base', one: 'one', sub: 'sub' } as const

/**
 * Streams the results of one search, page by page. Must run inside the session's `PagedQueue`.
 * Never throws for limits or cancellation; those end the search with `incomplete: true`.
 */
export async function pagedSearch(
  client: Client,
  request: PagedSearchRequest,
  options: PagedSearchOptions,
): Promise<PagedSearchResult> {
  const { signal } = options
  const limit = request.sizeLimit > 0 ? request.sizeLimit : Number.POSITIVE_INFINITY
  let total = 0
  const result = (incomplete: boolean, extra: Partial<PagedSearchResult> = {}): PagedSearchResult => ({
    incomplete,
    sizeLimitReached: false,
    cancelled: false,
    total,
    ...extra,
  })

  /** Emits entries up to the size limit; returns true when the limit was reached. */
  const emit = (raw: RawEntry[]): boolean => {
    const room = limit - total
    const accepted = raw.slice(0, room).map((entry) => decodeEntry(entry, options.isBinary))
    total += accepted.length
    if (accepted.length > 0) {
      options.onPage(accepted)
    }
    return raw.length > room || total >= limit
  }

  const searchOptions = {
    scope: SCOPES[request.scope],
    filter: request.filter,
    attributes: request.attributes.length > 0 ? request.attributes : ['*'],
    explicitBufferAttributes: new EveryAttribute(),
  }

  if (!options.supportsPaging) {
    return unpagedSearch(client, request, searchOptions, emit, result)
  }

  const pageSize = Math.min(request.pageSize ?? DEFAULT_PAGE_SIZE, limit)
  try {
    for await (const page of client.searchPaginated(request.base, {
      ...searchOptions,
      paged: { pageSize },
    })) {
      if (signal?.aborted) {
        return result(true, { cancelled: true })
      }
      if (emit(page.searchEntries as RawEntry[])) {
        return result(true, { sizeLimitReached: true })
      }
      if (signal?.aborted) {
        return result(true, { cancelled: true })
      }
    }
    if (total === 0) {
      await assertBaseExists(client, request.base)
    }
    return result(false)
  } catch (error) {
    if (isLimitResult(error)) {
      return result(true)
    }
    throw error
  }
}

/**
 * 389-DS answers a paged search on a missing base with success and no entries, where other
 * servers return noSuchObject. An empty result therefore gets a base lookup, which throws
 * noSuchObject if the base is gone, so a deleted node is not mistaken for an empty one.
 */
async function assertBaseExists(client: Client, base: string): Promise<void> {
  await client.search(base, { scope: 'base', filter: '(objectClass=*)', attributes: ['1.1'] })
}

/**
 * For servers without paged results. ldapts discards the entries when the server reports
 * sizeLimitExceeded unless the request carried a size limit itself, so after such a failure
 * the search is repeated with an explicit limit to recover the partial results.
 */
async function unpagedSearch(
  client: Client,
  request: PagedSearchRequest,
  searchOptions: Record<string, unknown>,
  emit: (raw: RawEntry[]) => boolean,
  result: (incomplete: boolean, extra?: Partial<PagedSearchResult>) => PagedSearchResult,
): Promise<PagedSearchResult> {
  const clientLimit = request.sizeLimit > 0 ? request.sizeLimit : 0
  try {
    const { searchEntries } = await client.search(request.base, { ...searchOptions, sizeLimit: clientLimit })
    const limited = emit(searchEntries as RawEntry[])
    return result(limited && clientLimit > 0, { sizeLimitReached: limited && clientLimit > 0 })
  } catch (error) {
    if (!isLimitResult(error)) {
      throw error
    }
    const { searchEntries } = await client.search(request.base, {
      ...searchOptions,
      sizeLimit: clientLimit > 0 ? clientLimit : 2 ** 31 - 1,
    })
    emit(searchEntries as RawEntry[])
    return result(true)
  }
}
