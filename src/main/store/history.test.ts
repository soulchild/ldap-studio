import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HistoryStore, MAX_RECENT_SEARCHES, type RecentSearch } from './history'

let directory: string
let store: HistoryStore

const search = (filter: string, overrides: Partial<RecentSearch> = {}): RecentSearch => ({
  base: 'dc=example,dc=com',
  scope: 'sub',
  filter,
  attributes: ['cn', 'mail'],
  sizeLimit: 1000,
  ...overrides,
})

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ldap-studio-history-'))
  store = new HistoryStore(directory)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('HistoryStore', () => {
  it('lists searches most recent first, per profile, and persists them', async () => {
    await store.add('p1', search('(uid=a)'))
    await store.add('p1', search('(uid=b)'))
    await store.add('p2', search('(uid=c)'))
    const reloaded = new HistoryStore(directory)
    expect((await reloaded.list('p1')).map((entry) => entry.filter)).toEqual(['(uid=b)', '(uid=a)'])
    expect((await reloaded.list('p2')).map((entry) => entry.filter)).toEqual(['(uid=c)'])
    expect(await reloaded.list('unknown')).toEqual([])
  })

  it('keeps a repeated search once and moves it to the top', async () => {
    await store.add('p1', search('(uid=a)'))
    await store.add('p1', search('(uid=b)'))
    await store.add('p1', search('(uid=a)', { attributes: ['MAIL', 'cn'] }))
    expect((await store.list('p1')).map((entry) => entry.filter)).toEqual(['(uid=a)', '(uid=b)'])
  })

  it('treats searches that differ in any parameter as different', async () => {
    await store.add('p1', search('(uid=a)'))
    await store.add('p1', search('(uid=a)', { scope: 'one' }))
    await store.add('p1', search('(uid=a)', { base: 'ou=people,dc=example,dc=com' }))
    await store.add('p1', search('(uid=a)', { sizeLimit: 0 }))
    await store.add('p1', search('(uid=a)', { attributes: [] }))
    expect(await store.list('p1')).toHaveLength(5)
  })

  it(`keeps only the ${MAX_RECENT_SEARCHES} most recent searches per profile`, async () => {
    for (let i = 1; i <= MAX_RECENT_SEARCHES + 5; i++) {
      await store.add('p1', search(`(uid=${i})`))
    }
    const list = await store.list('p1')
    expect(list).toHaveLength(MAX_RECENT_SEARCHES)
    expect(list[0]?.filter).toBe(`(uid=${MAX_RECENT_SEARCHES + 5})`)
    expect(list.at(-1)?.filter).toBe('(uid=6)')
  })

  it("forgets a deleted profile's history", async () => {
    await store.add('p1', search('(uid=a)'))
    await store.add('p2', search('(uid=b)'))
    await store.removeProfile('p1')
    expect(await new HistoryStore(directory).list('p1')).toEqual([])
    expect(await store.list('p2')).toHaveLength(1)
  })
})
