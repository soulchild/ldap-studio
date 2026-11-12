/** The Docker test servers (test/ldap), for e2e tests that need a directory. Throwaway credentials. */
import { connect } from 'node:net'

export const OPENLDAP = {
  host: 'localhost',
  port: 3389,
  adminDn: 'cn=admin,dc=example,dc=com',
  adminPassword: 'admin-test-pw',
}

/** A normal account: unlike the admin, it is subject to the servers' size limit of 100 entries. */
export const READER = { dn: 'uid=reader,ou=people,dc=example,dc=com', password: 'reader-test-pw' }

export function testServersRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: OPENLDAP.host, port: OPENLDAP.port })
    const done = (up: boolean) => {
      socket.destroy()
      resolve(up)
    }
    socket.setTimeout(500, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}
