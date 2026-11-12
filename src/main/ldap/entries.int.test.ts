import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Attribute, Change, Client } from 'ldapts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EntryAttribute } from '@shared/entry'
import {
  SUFFIX,
  TEST_SERVERS,
  testCaPem,
  testEnvAvailable,
  type TestServer,
} from '../../../test/integration/env'
import { toAppError } from './errors'
import { LdapSession } from './session'

const photo = new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../test/ldap/seed/photo.jpg')))

async function adminClient(server: TestServer): Promise<Client> {
  const client = new Client({ url: `ldap://${server.host}:${server.ldapPort}` })
  await client.bind(server.adminDn, server.adminPassword)
  return client
}

/** Test cleanup only: deletes a subtree deepest-first. */
async function removeSubtree(client: Client, base: string): Promise<void> {
  const { searchEntries } = await client.search(base, { scope: 'sub', attributes: ['1.1'] })
  const dns = searchEntries.map((entry) => entry.dn).sort((a, b) => b.split(',').length - a.split(',').length)
  for (const dn of dns) {
    await client.del(dn)
  }
}

function values(entry: { attributes: EntryAttribute[] } | null, name: string) {
  return entry?.attributes.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())?.values
}

const person = (cn: string): EntryAttribute[] => [
  { name: 'objectClass', values: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'] },
  { name: 'cn', values: [cn] },
  { name: 'sn', values: ['Tester'] },
]

describe.runIf(testEnvAvailable).each(TEST_SERVERS)('entry operations on $name (task 4.5)', (server) => {
  const container = `ou=it-${randomUUID().slice(0, 8)},${SUFFIX}`
  let session: LdapSession
  let admin: Client

  beforeAll(async () => {
    const result = await LdapSession.open({
      host: server.host,
      port: server.ldapPort,
      security: 'none',
      bindDn: server.adminDn,
      password: server.adminPassword,
      caCertificates: [testCaPem()],
    })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    session = result.value
    session.isBinary = (name) => name.toLowerCase() === 'jpegphoto'
    admin = await adminClient(server)
    await session.addEntry(container, [
      { name: 'objectClass', values: ['top', 'organizationalUnit'] },
      { name: 'ou', values: [container.split(',')[0]?.slice(3) ?? 'it'] },
    ])
    await session.addEntry(`ou=target,${container}`, [
      { name: 'objectClass', values: ['top', 'organizationalUnit'] },
      { name: 'ou', values: ['target'] },
    ])
  })

  afterAll(async () => {
    await removeSubtree(admin, container).catch(() => undefined)
    await admin?.unbind()
    await session?.close()
  })

  describe('readEntry', () => {
    it('reads user attributes and a change marker, without operational attributes', async () => {
      const entry = await session.readEntry(`uid=jdoe,ou=people,${SUFFIX}`, false)
      expect(values(entry, 'cn')).toEqual(['John Doe'])
      expect(values(entry, 'createTimestamp')).toBeUndefined()
      expect(values(entry, 'modifyTimestamp')).toBeUndefined()
      expect(entry?.changeMarker?.attribute).toBe(server.name === 'openldap' ? 'entryCSN' : 'modifyTimestamp')
      expect(entry?.attributes.every((attribute) => attribute.values.length > 0)).toBe(true)
    })

    it('includes operational attributes on request', async () => {
      const entry = await session.readEntry(`uid=jdoe,ou=people,${SUFFIX}`, true)
      expect(values(entry, 'createTimestamp')).toHaveLength(1)
      expect(entry?.attributes.some((attribute) => attribute.name === '+')).toBe(false)
    })

    it('returns null for a missing entry', async () => {
      expect(await session.readEntry(`uid=nobody,ou=people,${SUFFIX}`, false)).toBeNull()
    })
  })

  it('adds an entry with a binary value and reads it back byte-exact', async () => {
    const dn = `cn=photo,${container}`
    await session.addEntry(dn, [...person('photo'), { name: 'jpegPhoto', values: [photo] }])
    const stored = values(await session.readEntry(dn, false), 'jpegPhoto')?.[0]
    expect(stored).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(stored as Uint8Array).equals(Buffer.from(photo))).toBe(true)
  })

  it('reports adding an existing entry as entryAlreadyExists', async () => {
    const error = await session
      .addEntry(`ou=target,${container}`, person('x'))
      .catch((caught: unknown) => caught)
    expect(toAppError(error)).toMatchObject({
      kind: 'ldap',
      resultCode: 68,
      resultName: 'entryAlreadyExists',
    })
  })

  it('applies add, replace and delete changes in one modify', async () => {
    const dn = `cn=modify,${container}`
    await session.addEntry(dn, [...person('modify'), { name: 'description', values: ['one', 'two'] }])
    await session.modifyEntry(dn, [
      { operation: 'replace', attribute: 'sn', values: ['Changed'] },
      { operation: 'delete', attribute: 'description', values: ['one'] },
      { operation: 'add', attribute: 'mail', values: ['modify@example.com'] },
    ])
    const entry = await session.readEntry(dn, false)
    expect(values(entry, 'sn')).toEqual(['Changed'])
    expect(values(entry, 'description')).toEqual(['two'])
    expect(values(entry, 'mail')).toEqual(['modify@example.com'])
  })

  it('applies a modify when the change marker is unchanged', async () => {
    const dn = `cn=fresh,${container}`
    await session.addEntry(dn, person('fresh'))
    const loaded = await session.readEntry(dn, false)
    await session.modifyEntry(
      dn,
      [{ operation: 'replace', attribute: 'sn', values: ['Fresh'] }],
      loaded?.changeMarker,
    )
    expect(values(await session.readEntry(dn, false), 'sn')).toEqual(['Fresh'])
  })

  it('rejects a modify with assertionFailed after a concurrent change, applying nothing', async () => {
    const dn = `cn=stale,${container}`
    await session.addEntry(dn, person('stale'))
    const loaded = await session.readEntry(dn, false)
    expect(loaded?.changeMarker).toBeDefined()
    if (loaded?.changeMarker?.attribute === 'modifyTimestamp') {
      // modifyTimestamp has one-second precision; make sure the concurrent change lands in a later second.
      await new Promise((done) => setTimeout(done, 1100))
    }
    // Another client changes the entry after it was loaded.
    await admin.modify(
      dn,
      new Change({
        operation: 'replace',
        modification: new Attribute({ type: 'description', values: ['changed elsewhere'] }),
      }),
    )
    const error = await session
      .modifyEntry(dn, [{ operation: 'replace', attribute: 'sn', values: ['Mine'] }], loaded?.changeMarker)
      .catch((caught: unknown) => caught)
    expect(toAppError(error)).toMatchObject({ kind: 'ldap', resultCode: 122, resultName: 'assertionFailed' })
    expect(values(await session.readEntry(dn, false), 'sn')).toEqual(['Tester'])
  })

  describe('renameEntry', () => {
    it('renames and removes the old RDN value', async () => {
      const dn = `cn=old1,${container}`
      await session.addEntry(dn, person('old1'))
      const newDn = await session.renameEntry({ dn, newRdn: 'cn=new1', deleteOldRdn: true })
      expect(newDn).toBe(`cn=new1,${container}`)
      expect(await session.readEntry(dn, false)).toBeNull()
      expect(values(await session.readEntry(newDn, false), 'cn')).toEqual(['new1'])
    })

    it('renames and keeps the old RDN value when asked', async () => {
      const dn = `cn=old2,${container}`
      await session.addEntry(dn, person('old2'))
      const newDn = await session.renameEntry({ dn, newRdn: 'cn=new2', deleteOldRdn: false })
      expect(values(await session.readEntry(newDn, false), 'cn')?.sort()).toEqual(['new2', 'old2'])
    })

    it('moves an entry to a new parent', async () => {
      const dn = `cn=mover,${container}`
      await session.addEntry(dn, person('mover'))
      const newDn = await session.renameEntry({
        dn,
        newRdn: 'cn=mover',
        deleteOldRdn: true,
        newParent: `ou=target,${container}`,
      })
      expect(newDn).toBe(`cn=mover,ou=target,${container}`)
      expect(await session.readEntry(newDn, false)).not.toBeNull()
      expect(await session.readEntry(dn, false)).toBeNull()
    })

    it('reports server refusals as LDAP errors', async () => {
      const error = await session
        .renameEntry({ dn: `cn=missing,${container}`, newRdn: 'cn=other', deleteOldRdn: true })
        .catch((caught: unknown) => caught)
      expect(toAppError(error)).toMatchObject({ kind: 'ldap', resultCode: 32 })
    })
  })

  it('deletes an entry', async () => {
    const dn = `cn=doomed,${container}`
    await session.addEntry(dn, person('doomed'))
    await session.deleteEntry(dn)
    expect(await session.readEntry(dn, false)).toBeNull()
  })
})
