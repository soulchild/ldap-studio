/**
 * Task 4.1 spike: checks the ldapts behaviour the session design relies on (design §5, §6).
 * Kept as regression tests so a library upgrade that changes these assumptions fails loudly.
 */
import { X509Certificate } from 'node:crypto'
import tls from 'node:tls'
import { Client } from 'ldapts'
import { afterEach, describe, expect, it } from 'vitest'
import { BULK_COUNT, BULK_DN, READER, TEST_SERVERS, testCaPem, testEnvAvailable } from './env'

const clients: Client[] = []
function track(client: Client): Client {
  clients.push(client)
  return client
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.unbind().catch(() => undefined)))
})

describe.runIf(testEnvAvailable).each(TEST_SERVERS)('ldapts on $name', (server) => {
  const ldapUrl = `ldap://${server.host}:${server.ldapPort}`

  async function readerClient(): Promise<Client> {
    const client = track(new Client({ url: ldapUrl, timeout: 30_000 }))
    await client.bind(READER.dn, READER.password)
    return client
  }

  describe('paging', () => {
    it('yields one page per round trip, so pages can be streamed', async () => {
      const client = await readerClient()
      const pageSizes: number[] = []
      for await (const page of client.searchPaginated(BULK_DN, {
        scope: 'one',
        attributes: ['1.1'],
        paged: { pageSize: 500 },
      })) {
        pageSizes.push(page.searchEntries.length)
      }
      expect(pageSizes.length).toBeGreaterThanOrEqual(10)
      expect(pageSizes.reduce((a, b) => a + b, 0)).toBe(BULK_COUNT)
    })

    it('keeps the connection usable after a paged search is abandoned mid-way', async () => {
      const client = await readerClient()
      let pages = 0
      for await (const _page of client.searchPaginated(BULK_DN, {
        scope: 'one',
        attributes: ['1.1'],
        paged: { pageSize: 200 },
      })) {
        pages++
        if (pages === 2) {
          break
        }
      }
      expect(pages).toBe(2)
      let total = 0
      for await (const page of client.searchPaginated(BULK_DN, {
        scope: 'one',
        attributes: ['1.1'],
        paged: { pageSize: 1000 },
      })) {
        total += page.searchEntries.length
      }
      expect(total).toBe(BULK_COUNT)
    })

    // Why sessions queue paged operations (design §5): OpenLDAP keeps one paged state per connection.
    it('interleaves paged searches on one connection only on 389-DS', async () => {
      const client = await readerClient()
      const options = { scope: 'one' as const, attributes: ['1.1'], paged: { pageSize: 500 } }
      const first = client.searchPaginated(BULK_DN, options)
      const second = client.searchPaginated(BULK_DN, options)
      const totals = [0, 0]
      let outcome: 'ok' | string = 'ok'
      try {
        let done = [false, false]
        while (!done[0] || !done[1]) {
          for (const [index, generator] of [first, second].entries()) {
            if (done[index]) {
              continue
            }
            const next = await generator.next()
            if (next.done) {
              done = done.map((value, i) => (i === index ? true : value))
            } else {
              totals[index] = (totals[index] ?? 0) + next.value.searchEntries.length
            }
          }
        }
      } catch (error) {
        outcome = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
      }
      if (server.name === 'openldap') {
        expect(outcome).toMatch(/cookie is invalid or old/)
      } else {
        expect(outcome).toBe('ok')
        expect(totals).toEqual([BULK_COUNT, BULK_COUNT])
      }
    })
  })

  describe('binary attributes', () => {
    const jdoe = 'uid=jdoe,ou=people,dc=example,dc=com'

    it('matches explicitBufferAttributes against the attribute name as the server returns it', async () => {
      const client = await readerClient()
      const exact = await client.search(jdoe, {
        scope: 'base',
        attributes: ['jpegPhoto'],
        explicitBufferAttributes: ['jpegPhoto'],
      })
      expect(Buffer.isBuffer(exact.searchEntries[0]?.jpegPhoto)).toBe(true)
      const lowerCase = await client.search(jdoe, {
        scope: 'base',
        attributes: ['jpegPhoto'],
        explicitBufferAttributes: ['jpegphoto'],
      })
      // A JPEG is not valid UTF-8, so it comes back as bytes even when the name does not match.
      // Text-like binary values would not, which is why sessions request every value as bytes.
      expect(Buffer.isBuffer(lowerCase.searchEntries[0]?.jpegPhoto)).toBe(true)
    })

    it('returns every attribute as bytes when explicitBufferAttributes matches everything', async () => {
      class EveryAttribute extends Array<string> {
        override includes(): boolean {
          return true
        }
      }
      const client = await readerClient()
      const result = await client.search(jdoe, {
        scope: 'base',
        attributes: ['*'],
        explicitBufferAttributes: new EveryAttribute(),
      })
      const entry = result.searchEntries[0] ?? {}
      const values = Object.entries(entry).filter(([name]) => name !== 'dn')
      expect(values.length).toBeGreaterThan(5)
      for (const [, value] of values) {
        for (const item of [value].flat()) {
          expect(Buffer.isBuffer(item)).toBe(true)
        }
      }
    })
  })

  describe('TLS certificate handling', () => {
    /** Records the TLS socket so the test can inspect the peer certificate. */
    function capturingConnect(sockets: tls.TLSSocket[]) {
      return ((...args: Parameters<typeof tls.connect>) => {
        const socket = (tls.connect as (...a: unknown[]) => tls.TLSSocket)(...args)
        sockets.push(socket)
        return socket
      }) as typeof tls.connect
    }

    it('exposes the certificate and verification error of an untrusted server', async () => {
      const sockets: tls.TLSSocket[] = []
      const client = track(
        new Client({
          url: `ldaps://${server.host}:${server.ldapsPort}`,
          tlsOptions: { rejectUnauthorized: false, servername: server.host },
          createSecureConnection: capturingConnect(sockets),
        }),
      )
      await client.search('', { scope: 'base', attributes: ['namingContexts'] })
      const socket = sockets[0]
      expect(socket?.authorized).toBe(false)
      expect(String(socket?.authorizationError)).toMatch(
        /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|unable to get local issuer/i,
      )
      const certificate = socket?.getPeerX509Certificate()
      expect(certificate?.subject).toContain('CN=localhost')
      expect(certificate?.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    })

    it('reports a hostname mismatch as an authorization error when the chain is trusted', async () => {
      const sockets: tls.TLSSocket[] = []
      const client = track(
        new Client({
          url: `ldaps://127.0.0.1:${server.ldapsPort}`,
          tlsOptions: { rejectUnauthorized: false, ca: [testCaPem()] },
          createSecureConnection: capturingConnect(sockets),
        }),
      )
      await client.search('', { scope: 'base', attributes: ['namingContexts'] })
      expect(sockets[0]?.authorized).toBe(false)
      expect(String(sockets[0]?.authorizationError)).toMatch(/ALTNAME|Hostname/i)
    })

    it('does not call checkServerIdentity for an untrusted chain, so pinning needs a secureConnect check', async () => {
      let called = false
      const client = track(
        new Client({
          url: `ldaps://${server.host}:${server.ldapsPort}`,
          tlsOptions: {
            rejectUnauthorized: false,
            servername: server.host,
            checkServerIdentity: () => {
              called = true
              return undefined
            },
          },
        }),
      )
      await client.search('', { scope: 'base', attributes: ['namingContexts'] })
      expect(called).toBe(false)
    })

    it('can stop a connection in secureConnect before any request is sent', async () => {
      const verified: string[] = []
      const createSecureConnection = ((...args: unknown[]) => {
        const socket = (tls.connect as (...a: unknown[]) => tls.TLSSocket)(...args)
        socket.once('secureConnect', () => {
          const fingerprint = socket.getPeerX509Certificate()?.fingerprint256 ?? ''
          verified.push(fingerprint)
          socket.destroy(new Error('fingerprint mismatch'))
        })
        return socket
      }) as typeof tls.connect
      const client = track(
        new Client({
          url: `ldaps://${server.host}:${server.ldapsPort}`,
          tlsOptions: { rejectUnauthorized: false, servername: server.host },
          createSecureConnection,
          timeout: 5000,
        }),
      )
      await expect(client.bind(server.adminDn, server.adminPassword)).rejects.toThrow()
      expect(verified).toHaveLength(1)
    })

    it('works the same way for StartTLS, which passes the plain socket in the options', async () => {
      const sockets: tls.TLSSocket[] = []
      const client = track(new Client({ url: ldapUrl, createSecureConnection: capturingConnect(sockets) }))
      await client.startTLS({ rejectUnauthorized: false, servername: server.host })
      expect(sockets).toHaveLength(1)
      expect(sockets[0]?.getPeerX509Certificate()).toBeInstanceOf(X509Certificate)
      const { searchEntries } = await client.search('', { scope: 'base', attributes: ['namingContexts'] })
      expect(searchEntries).toHaveLength(1)
    })

    it('writes the plain socket into the options object passed to startTLS', async () => {
      const client = track(new Client({ url: ldapUrl }))
      const options: tls.ConnectionOptions = { ca: [testCaPem()], servername: server.host }
      await client.startTLS(options)
      expect(options.socket).toBeDefined()
    })
  })
})
