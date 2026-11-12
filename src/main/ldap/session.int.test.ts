import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppError, Result } from '@shared/ipc'
import { startStartTlsRefusingServer } from '../../../test/integration/fake-ldap-server'
import {
  SUFFIX,
  TEST_SERVERS,
  testCaPem,
  testEnvAvailable,
  type TestServer,
} from '../../../test/integration/env'
import { LdapSession, type SessionConfig } from './session'

const serverCertificate = new X509Certificate(
  readFileSync(resolve(import.meta.dirname, '../../../test/ldap/certs/server.crt')),
)
const WRONG_FINGERPRINT = Array.from({ length: 32 }, () => 'AB').join(':')

const sessions: LdapSession[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()))
})

async function open(config: SessionConfig): Promise<Result<LdapSession>> {
  const result = await LdapSession.open(config)
  if (result.ok) {
    sessions.push(result.value)
  }
  return result
}

function expectError(result: Result<LdapSession>): AppError {
  if (result.ok) {
    throw new Error('expected the connection to fail')
  }
  return result.error
}

function config(server: TestServer, overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    host: server.host,
    port: server.ldapPort,
    security: 'none',
    bindDn: server.adminDn,
    password: server.adminPassword,
    caCertificates: [testCaPem()],
    connectTimeoutMs: 5000,
    operationTimeoutMs: 10_000,
    ...overrides,
  }
}

describe.runIf(testEnvAvailable).each(TEST_SERVERS)('LdapSession.open on $name', (server) => {
  const ldaps = { security: 'ldaps' as const, port: server.ldapsPort }
  const startTls = { security: 'starttls' as const }

  describe('transports (task 4.2)', () => {
    it.each([
      ['plain LDAP', {}],
      ['LDAPS', ldaps],
      ['StartTLS', startTls],
    ])('connects and binds over %s', async (_label, overrides) => {
      const result = await open(config(server, overrides))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.isOpen).toBe(true)
      }
    })

    it.each([
      ['LDAPS', ldaps],
      ['StartTLS', startTls],
    ])('rejects an untrusted certificate over %s and reports its details', async (_label, overrides) => {
      const error = expectError(await open(config(server, { ...overrides, caCertificates: [] })))
      expect(error).toMatchObject({
        kind: 'certificateUntrusted',
        fingerprintMismatch: false,
        reason: 'The certificate was issued by a certificate authority that is not trusted.',
        certificate: {
          subject: 'CN=localhost',
          issuer: 'CN=LDAP Studio Test CA',
          fingerprint256: serverCertificate.fingerprint256,
        },
      })
    })

    it('rejects a hostname mismatch even when the CA is trusted', async () => {
      const error = expectError(await open(config(server, { ...ldaps, host: '127.0.0.1' })))
      expect(error).toMatchObject({
        kind: 'certificateUntrusted',
        reason: 'The certificate is not valid for this host name.',
      })
    })

    it.each([
      ['LDAPS', ldaps],
      ['StartTLS', startTls],
    ])(
      'accepts an untrusted certificate over %s when its fingerprint is pinned',
      async (_label, overrides) => {
        const fingerprint = serverCertificate.fingerprint256.toLowerCase()
        const result = await open(
          config(server, { ...overrides, caCertificates: [], trustedFingerprint: fingerprint }),
        )
        expect(result.ok).toBe(true)
      },
    )

    it('rejects a different certificate when another fingerprint is pinned', async () => {
      const error = expectError(
        await open(config(server, { ...ldaps, caCertificates: [], trustedFingerprint: WRONG_FINGERPRINT })),
      )
      expect(error).toMatchObject({
        kind: 'certificateUntrusted',
        fingerprintMismatch: true,
        message: 'The server certificate differs from the one you trusted.',
      })
    })

    it('still accepts a pinned server whose new certificate verifies normally', async () => {
      const result = await open(config(server, { ...ldaps, trustedFingerprint: WRONG_FINGERPRINT }))
      expect(result.ok).toBe(true)
    })
  })

  describe('bind and root DSE (task 4.3)', () => {
    it('reports a wrong password as invalid credentials', async () => {
      const error = expectError(await open(config(server, { password: 'wrong-password' })))
      expect(error).toMatchObject({ kind: 'ldap', resultCode: 49, resultName: 'invalidCredentials' })
    })

    it('binds anonymously when the bind DN is empty', async () => {
      const result = await open(config(server, { bindDn: '', password: undefined }))
      expect(result.ok).toBe(true)
    })

    it('refuses a bind DN without a password instead of sending an unauthenticated bind', async () => {
      const error = expectError(await open(config(server, { password: '' })))
      expect(error.kind).toBe('invalidRequest')
    })

    it('reads naming contexts, controls and the subschema entry from the root DSE', async () => {
      const result = await open(config(server))
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      const rootDse = result.value.rootDse
      expect(rootDse.namingContexts).toContain(SUFFIX)
      expect(rootDse.supportedControls).toContain('1.2.840.113556.1.4.319')
      expect(rootDse.subschemaSubentry).toMatch(/^cn=(subschema|schema)$/i)
      expect(rootDse.isActiveDirectory).toBe(false)
    })
  })
})

describe.runIf(testEnvAvailable)('LdapSession.open failure modes', () => {
  it('closes the connection when the server refuses StartTLS, without sending the bind', async () => {
    const fake = await startStartTlsRefusingServer()
    try {
      const error = expectError(
        await open({
          host: '127.0.0.1',
          port: fake.port,
          security: 'starttls',
          bindDn: 'cn=admin,dc=example,dc=com',
          password: 'secret',
          caCertificates: [],
          connectTimeoutMs: 2000,
          operationTimeoutMs: 2000,
        }),
      )
      expect(error.kind).toBe('startTlsRefused')
      expect(fake.messagesReceived()).toBe(1)
    } finally {
      await fake.close()
    }
  })

  it('reports a closed port as a network error', async () => {
    const error = expectError(
      await open({
        host: '127.0.0.1',
        port: 1,
        security: 'none',
        bindDn: '',
        caCertificates: [],
        connectTimeoutMs: 2000,
      }),
    )
    expect(error).toEqual({
      kind: 'network',
      message: 'Connection refused: nothing is listening on that host and port.',
    })
  })
})
