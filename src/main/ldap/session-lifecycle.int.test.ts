import { afterEach, describe, expect, it } from 'vitest'
import type { LogRecord } from '@shared/ipc'
import { startTcpProxy, type TcpProxy } from '../../../test/integration/tcp-proxy'
import {
  PEOPLE_COUNT,
  SUFFIX,
  TEST_SERVERS,
  testCaPem,
  testEnvAvailable,
} from '../../../test/integration/env'
import { toAppError } from './errors'
import { OperationLog } from './oplog'
import { LdapSession, type SessionConfig } from './session'

const proxies: TcpProxy[] = []
const sessions: LdapSession[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
})

describe.runIf(testEnvAvailable).each(TEST_SERVERS)('session lifecycle on $name (task 4.7)', (server) => {
  async function open(overrides: Partial<SessionConfig> = {}) {
    const log = new OperationLog()
    const result = await LdapSession.open({
      host: server.host,
      port: server.ldapPort,
      security: 'none',
      bindDn: server.adminDn,
      password: server.adminPassword,
      caCertificates: [testCaPem()],
      log: { log, connectionId: 'c1', profileName: 'test profile' },
      ...overrides,
    })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    sessions.push(result.value)
    return { session: result.value, log }
  }

  describe('operation log', () => {
    it('records the bind with the DN but never the password', async () => {
      const { log } = await open()
      const bind = log.entries().find((record) => record.operation === 'bind')
      expect(bind).toMatchObject({
        connectionId: 'c1',
        profileName: 'test profile',
        dn: server.adminDn,
        resultCode: 0,
        message: 'Simple bind',
      })
      expect(JSON.stringify(log.entries())).not.toContain(server.adminPassword)
    })

    it('records a failed bind with its result code, still without the password', async () => {
      const log = new OperationLog()
      await LdapSession.open({
        host: server.host,
        port: server.ldapPort,
        security: 'none',
        bindDn: server.adminDn,
        password: 'wrong-secret-value',
        caCertificates: [],
        log: { log, connectionId: 'c2', profileName: 'p' },
      })
      expect(log.entries()).toEqual([expect.objectContaining({ operation: 'bind', resultCode: 49 })])
      expect(JSON.stringify(log.entries())).not.toContain('wrong-secret-value')
    })

    it('records searches, reads and failed modifies with timing and result codes', async () => {
      const { session, log } = await open()
      const records: LogRecord[] = []
      log.subscribe((record) => records.push(record))
      await session.search(
        {
          base: `ou=people,${SUFFIX}`,
          scope: 'one',
          filter: '(objectClass=*)',
          attributes: ['1.1'],
          sizeLimit: 0,
        },
        { onPage: () => undefined },
      )
      await session.readEntry(`uid=jdoe,ou=people,${SUFFIX}`, false)
      await session
        .modifyEntry(`uid=nobody,ou=people,${SUFFIX}`, [
          { operation: 'replace', attribute: 'sn', values: ['x'] },
        ])
        .catch(() => undefined)
      expect(records.map((record) => [record.operation, record.resultCode])).toEqual([
        ['search', 0],
        ['search', 0],
        ['modify', 32],
      ])
      expect(records[0]?.message).toBe(`one (objectClass=*): ${PEOPLE_COUNT} entries`)
      expect(records.every((record) => record.durationMs >= 0)).toBe(true)
    })
  })

  describe('connection loss', () => {
    it('reports a dropped connection and refuses further operations without reconnecting', async () => {
      const proxy = await startTcpProxy(server.host, server.ldapPort)
      proxies.push(proxy)
      const { session } = await open({ host: '127.0.0.1', port: proxy.port })
      const lost = new Promise<void>((resolve) => session.onConnectionLost(resolve))
      expect(session.isOpen).toBe(true)

      proxy.dropAll()
      await lost

      expect(session.isOpen).toBe(false)
      expect(session.isLost).toBe(true)
      const error = await session
        .readEntry(`uid=jdoe,ou=people,${SUFFIX}`, false)
        .catch((caught: unknown) => caught)
      expect(toAppError(error)).toMatchObject({ kind: 'notConnected' })
      // ldapts would otherwise reconnect silently, unauthenticated; the proxy must see no second connection.
      expect(proxy.connections()).toBe(1)
    })

    it('does not report a loss when the session is closed on purpose', async () => {
      const { session } = await open()
      let reported = false
      session.onConnectionLost(() => (reported = true))
      await session.close()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(reported).toBe(false)
      expect(session.isOpen).toBe(false)
    })
  })
})
