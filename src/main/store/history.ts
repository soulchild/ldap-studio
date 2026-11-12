/** Recent searches per connection profile in `history.json` (directory-search spec: recent searches). */
import { join } from 'node:path'
import { z } from 'zod'
import { searchScopeSchema } from '@shared/ipc'
import { JsonStore } from './json-store'

export const MAX_RECENT_SEARCHES = 50

export const recentSearchSchema = z.object({
  base: z.string(),
  scope: searchScopeSchema,
  filter: z.string().min(1),
  attributes: z.array(z.string()),
  sizeLimit: z.number().int().min(0),
})
export type RecentSearch = z.infer<typeof recentSearchSchema>

const fileSchema = z.object({ searches: z.record(z.string(), z.array(recentSearchSchema)) })

/** Two searches are the same when every parameter matches; attribute order and case do not matter. */
function sameSearch(a: RecentSearch, b: RecentSearch): boolean {
  const attributes = (search: RecentSearch) =>
    search.attributes
      .map((name) => name.toLowerCase())
      .sort()
      .join(',')
  return (
    a.base === b.base &&
    a.scope === b.scope &&
    a.filter === b.filter &&
    a.sizeLimit === b.sizeLimit &&
    attributes(a) === attributes(b)
  )
}

export class HistoryStore {
  private readonly file: JsonStore<z.infer<typeof fileSchema>>
  private cache: Record<string, RecentSearch[]> | undefined

  constructor(dataDirectory: string) {
    this.file = new JsonStore(join(dataDirectory, 'history.json'), {
      version: 1,
      schema: fileSchema,
      defaults: () => ({ searches: {} }),
    })
  }

  /** Most recent first. */
  async list(profileId: string): Promise<RecentSearch[]> {
    return [...((await this.load())[profileId] ?? [])]
  }

  /** Records a search at the top of the list, removing an earlier identical one and the oldest beyond the cap. */
  async add(profileId: string, search: RecentSearch): Promise<RecentSearch[]> {
    const entry = recentSearchSchema.parse(search)
    const all = await this.load()
    const next = [entry, ...(all[profileId] ?? []).filter((existing) => !sameSearch(existing, entry))].slice(
      0,
      MAX_RECENT_SEARCHES,
    )
    await this.persist({ ...all, [profileId]: next })
    return [...next]
  }

  /** Forgets a profile's history, e.g. when the profile is deleted. */
  async removeProfile(profileId: string): Promise<void> {
    const { [profileId]: _removed, ...rest } = await this.load()
    await this.persist(rest)
  }

  private async load(): Promise<Record<string, RecentSearch[]>> {
    this.cache ??= (await this.file.read()).searches
    return this.cache
  }

  private async persist(searches: Record<string, RecentSearch[]>): Promise<void> {
    await this.file.write({ searches })
    this.cache = searches
  }
}
