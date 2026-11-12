/**
 * Connection details for the Docker test servers (test/ldap). Throwaway test credentials.
 * `testEnvAvailable` is false when the servers are not running, so integration suites can skip.
 */
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { resolve } from 'node:path'

export interface TestServer {
  name: 'openldap' | '389ds'
  host: string
  ldapPort: number
  ldapsPort: number
  adminDn: string
  adminPassword: string
}

export const SUFFIX = 'dc=example,dc=com'
export const READER = { dn: 'uid=reader,ou=people,dc=example,dc=com', password: 'reader-test-pw' }
/** May change and delete inside ou=it-* containers, except entries named cn=protected*. */
export const DELETER = { dn: 'uid=deleter,ou=people,dc=example,dc=com', password: 'deleter-test-pw' }
/** Cannot read the subschema entry. */
export const NOSCHEMA = { dn: 'uid=noschema,ou=people,dc=example,dc=com', password: 'noschema-test-pw' }
export const BULK_DN = 'ou=bulk,dc=example,dc=com'
export const BULK_COUNT = 5000
/** Entries directly under ou=people in the seed (test/ldap/seed.mjs). */
export const PEOPLE_COUNT = 6

export const TEST_SERVERS: TestServer[] = [
  {
    name: 'openldap',
    host: 'localhost',
    ldapPort: 3389,
    ldapsPort: 3636,
    adminDn: 'cn=admin,dc=example,dc=com',
    adminPassword: 'admin-test-pw',
  },
  {
    name: '389ds',
    host: 'localhost',
    ldapPort: 4389,
    ldapsPort: 4636,
    adminDn: 'cn=Directory Manager',
    adminPassword: 'admin-test-pw',
  },
]

const certDir = resolve(import.meta.dirname, '../ldap/certs')

/** PEM of the test CA that signed both servers' certificates. */
export function testCaPem(): string {
  return readFileSync(resolve(certDir, 'ca.crt'), 'utf8')
}

function portOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port })
    const finish = (open: boolean) => {
      socket.destroy()
      done(open)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function probe(): Promise<boolean> {
  const results = await Promise.all(TEST_SERVERS.map((server) => portOpen(server.host, server.ldapPort)))
  const available = results.every(Boolean)
  if (!available) {
    console.warn(
      'Integration tests skipped: test servers are not running. Start them with `pnpm test:env:up`.',
    )
  }
  return available
}

export const testEnvAvailable = await probe()
