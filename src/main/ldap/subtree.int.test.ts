import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EntryAttribute } from '@shared/entry'
import {
  DELETER,
  SUFFIX,
  TEST_SERVERS,
  testCaPem,
  testEnvAvailable,
  type TestServer,
} from '../../../test/integration/env'
import { LdapSession } from './session'
import { countSubtree, deleteSubtree } from './subtree'

const ou = (name: string): EntryAttribute[] => [
  { name: 'objectClass', values: ['top', 'organizationalUnit'] },
  { name: 'ou', values: [name] },
]
const person = (cn: string): EntryAttribute[] => [
  { name: 'objectClass', values: ['top', 'person'] },
  { name: 'cn', values: [cn] },
  { name: 'sn', values: ['Tester'] },
]

async function openAs(server: TestServer, dn: string, password: string): Promise<LdapSession> {
  const result = await LdapSession.open({
    host: server.host,
    port: server.ldapPort,
    security: 'none',
    bindDn: dn,
    password,
    caCertificates: [testCaPem()],
  })
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.value
}

/** Builds ou=<name> with 4 sub-OUs of 29 people each: 1 + 4 + 116 = 121 entries. */
async function buildTree(
  session: LdapSession,
  base: string,
  extra: (dn: string) => Promise<void> = async () => {},
) {
  const top = base.split(',')[0]?.slice(3) ?? 'it'
  await session.addEntry(base, ou(top))
  for (let group = 1; group <= 4; group++) {
    const groupDn = `ou=g${group},${base}`
    await session.addEntry(groupDn, ou(`g${group}`))
    for (let i = 1; i <= 29; i++) {
      await session.addEntry(`cn=p${i},${groupDn}`, person(`p${i}`))
    }
  }
  await extra(base)
}

describe.runIf(testEnvAvailable).each(TEST_SERVERS)(
  'subtree count and delete on $name (task 4.6)',
  (server) => {
    let admin: LdapSession
    let deleter: LdapSession
    const created: string[] = []
    const base = () => {
      const dn = `ou=it-${randomUUID().slice(0, 8)},${SUFFIX}`
      created.push(dn)
      return dn
    }

    beforeAll(async () => {
      admin = await openAs(server, server.adminDn, server.adminPassword)
      deleter = await openAs(server, DELETER.dn, DELETER.password)
    })

    afterAll(async () => {
      for (const dn of created) {
        await deleteSubtree(admin, dn, { onProgress: () => undefined }).catch(() => undefined)
      }
      await admin?.close()
      await deleter?.close()
    })

    it('counts every entry in the subtree, the base included', async () => {
      const dn = base()
      await buildTree(admin, dn)
      expect(await countSubtree(admin, dn)).toEqual({ count: 121, incomplete: false })
    })

    it('deletes all 121 entries with progress, children before parents', async () => {
      const dn = base()
      await buildTree(admin, dn)
      const progress: number[] = []
      const result = await deleteSubtree(admin, dn, { onProgress: ({ deleted }) => progress.push(deleted) })
      expect(result).toEqual({ deleted: 121, total: 121, cancelled: false })
      expect(progress[0]).toBe(0)
      expect(progress.at(-1)).toBe(121)
      expect(await admin.readEntry(dn, false)).toBeNull()
    })

    it('stops between entries when cancelled and leaves the rest', async () => {
      const dn = base()
      await buildTree(admin, dn)
      const controller = new AbortController()
      const result = await deleteSubtree(admin, dn, {
        signal: controller.signal,
        onProgress: ({ deleted }) => {
          if (deleted === 10) {
            controller.abort()
          }
        },
      })
      expect(result).toMatchObject({ deleted: 10, total: 121, cancelled: true })
      expect((await countSubtree(admin, dn)).count).toBe(111)
    })

    it('stops at an entry it may not delete and reports the count and the DN', async () => {
      const dn = base()
      const protectedDn = `cn=protected-entry,${dn}`
      await buildTree(admin, dn, () => admin.addEntry(protectedDn, person('protected-entry')))
      const result = await deleteSubtree(deleter, dn, { onProgress: () => undefined })
      expect(result).toMatchObject({
        total: 122,
        cancelled: false,
        failedDn: protectedDn,
        error: { kind: 'ldap', resultCode: 50, resultName: 'insufficientAccessRights' },
      })
      expect(result.deleted).toBeGreaterThan(0)
      expect(result.deleted).toBeLessThan(122)
      expect(await admin.readEntry(protectedDn, false)).not.toBeNull()
    })
  },
)
