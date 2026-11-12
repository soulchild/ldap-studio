import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SearchEntry } from '@shared/ipc'
import {
  BULK_COUNT,
  BULK_DN,
  PEOPLE_COUNT,
  READER,
  SUFFIX,
  TEST_SERVERS,
  testCaPem,
  testEnvAvailable,
} from '../../../test/integration/env'
import { toAppError } from './errors'
import { CancelledError, type PagedSearchRequest } from './paged'
import { LdapSession } from './session'

const photo = readFileSync(resolve(import.meta.dirname, '../../../test/ldap/seed/photo.jpg'))
const bulkChildren: PagedSearchRequest = {
  base: BULK_DN,
  scope: 'one',
  filter: '(objectClass=*)',
  attributes: ['1.1'],
  sizeLimit: 0,
}

describe.runIf(testEnvAvailable).each(TEST_SERVERS)('paged search on $name (task 4.4)', (server) => {
  let session: LdapSession

  beforeAll(async () => {
    // Bind as the reader: admin accounts are exempt from the server's size limit of 100.
    const result = await LdapSession.open({
      host: server.host,
      port: server.ldapPort,
      security: 'none',
      bindDn: READER.dn,
      password: READER.password,
      caCertificates: [testCaPem()],
    })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    session = result.value
  })

  afterAll(async () => {
    await session?.close()
  })

  function collect() {
    const pages: SearchEntry[][] = []
    return {
      pages,
      onPage: (entries: SearchEntry[]) => pages.push(entries),
      count: () => pages.flat().length,
    }
  }

  it('lists all 5,000 children past the server size limit, emitting pages as they arrive', async () => {
    const sink = collect()
    const result = await session.search({ ...bulkChildren, pageSize: 500 }, { onPage: sink.onPage })
    expect(result).toEqual({
      incomplete: false,
      sizeLimitReached: false,
      cancelled: false,
      total: BULK_COUNT,
    })
    expect(sink.count()).toBe(BULK_COUNT)
    expect(sink.pages.length).toBeGreaterThanOrEqual(10)
    expect(new Set(sink.pages.flat().map((entry) => entry.dn)).size).toBe(BULK_COUNT)
  })

  it('stops at the requested size limit', async () => {
    const sink = collect()
    const result = await session.search({ ...bulkChildren, sizeLimit: 1234 }, { onPage: sink.onPage })
    expect(result).toMatchObject({ incomplete: true, sizeLimitReached: true, total: 1234 })
    expect(sink.count()).toBe(1234)
  })

  it('stops after the current page when cancelled, and the connection stays usable', async () => {
    const controller = new AbortController()
    const sink = collect()
    const result = await session.search(
      { ...bulkChildren, pageSize: 200 },
      {
        signal: controller.signal,
        onPage: (entries) => {
          sink.onPage(entries)
          controller.abort()
        },
      },
    )
    expect(result).toMatchObject({ incomplete: true, cancelled: true, total: 200 })
    expect(sink.pages).toHaveLength(1)
    const after = collect()
    await session.search(bulkChildren, { onPage: after.onPage })
    expect(after.count()).toBe(BULK_COUNT)
  })

  it('runs two paged searches on one connection one after the other', async () => {
    const first = collect()
    const second = collect()
    let queued = false
    const [a, b] = await Promise.all([
      session.search({ ...bulkChildren, pageSize: 500 }, { onPage: first.onPage }),
      session.search(
        { ...bulkChildren, pageSize: 500 },
        { onPage: second.onPage, onQueued: () => (queued = true) },
      ),
    ])
    expect(queued).toBe(true)
    expect([a.total, b.total]).toEqual([BULK_COUNT, BULK_COUNT])
  })

  it('removes a search cancelled while queued without running it', async () => {
    const controller = new AbortController()
    const running = session.search(bulkChildren, { onPage: () => undefined })
    const queuedSearch = session.search(bulkChildren, { onPage: () => undefined, signal: controller.signal })
    controller.abort()
    await expect(queuedSearch).rejects.toBeInstanceOf(CancelledError)
    await expect(running).resolves.toMatchObject({ total: BULK_COUNT })
  })

  it('marks the result incomplete when a server without paging hits its size limit', async () => {
    const withoutPaging = Object.create(session, {
      supportsPaging: { value: false },
    }) as LdapSession
    const sink = collect()
    const result = await LdapSession.prototype.search.call(withoutPaging, bulkChildren, {
      onPage: sink.onPage,
    })
    expect(result).toMatchObject({ incomplete: true, sizeLimitReached: false })
    expect(sink.count()).toBe(100)
  })

  it('completes an unpaged search that stays within the server limit', async () => {
    const withoutPaging = Object.create(session, { supportsPaging: { value: false } }) as LdapSession
    const sink = collect()
    const result = await LdapSession.prototype.search.call(
      withoutPaging,
      {
        base: `ou=people,${SUFFIX}`,
        scope: 'one',
        filter: '(objectClass=*)',
        attributes: ['1.1'],
        sizeLimit: 0,
      },
      { onPage: sink.onPage },
    )
    expect(result).toMatchObject({ incomplete: false, total: PEOPLE_COUNT })
  })

  it('returns text as strings and binary values byte-exact', async () => {
    const sink = collect()
    await session.search(
      {
        base: `uid=jdoe,ou=people,${SUFFIX}`,
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: ['cn', 'jpegPhoto', 'userCertificate;binary', 'telephoneNumber'],
        sizeLimit: 0,
      },
      { onPage: sink.onPage },
    )
    const attributes = new Map(sink.pages.flat()[0]?.attributes.map((a) => [a.name.toLowerCase(), a.values]))
    expect(attributes.get('cn')).toEqual(['John Doe'])
    expect(attributes.get('telephonenumber')).toEqual(['+49 30 1234567', '+49 30 7654321'])
    const storedPhoto = attributes.get('jpegphoto')?.[0]
    expect(storedPhoto).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(storedPhoto as Uint8Array).equals(photo)).toBe(true)
    const certificate = attributes.get('usercertificate;binary')?.[0] as Uint8Array
    expect(certificate).toBeInstanceOf(Uint8Array)
    expect(certificate[0]).toBe(0x30)
  })

  it('returns an empty, complete result for an existing entry without children', async () => {
    const result = await session.search(
      { ...bulkChildren, base: `uid=jdoe,ou=people,${SUFFIX}` },
      { onPage: () => undefined },
    )
    expect(result).toEqual({ incomplete: false, sizeLimitReached: false, cancelled: false, total: 0 })
  })

  // 389-DS answers a paged search on a missing base with success and no entries.
  it('throws server errors such as a missing base for the caller to report', async () => {
    const error = await session
      .search({ ...bulkChildren, base: `ou=missing,${SUFFIX}` }, { onPage: () => undefined })
      .catch((caught: unknown) => caught)
    expect(toAppError(error)).toMatchObject({ kind: 'ldap', resultCode: 32 })
  })
})
