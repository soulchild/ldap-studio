import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StorageError } from '../store/json-store'
import { describeCertificate, importCaCertificate } from './certificates'

const certDir = resolve(import.meta.dirname, '../../../test/ldap/certs')
const caPem = (() => {
  try {
    return readFileSync(resolve(certDir, 'ca.crt'))
  } catch {
    return undefined
  }
})()

describe.runIf(caPem)('certificate import', () => {
  it('reads a PEM certificate and describes it', () => {
    const result = importCaCertificate(new Uint8Array(caPem!))
    expect(result.pem).toMatch(/^-----BEGIN CERTIFICATE-----/)
    expect(result.info).toMatchObject({ subject: 'CN=LDAP Studio Test CA', issuer: 'CN=LDAP Studio Test CA' })
    expect(result.info.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  })

  it('reads a DER certificate and stores it as PEM', () => {
    const der = Buffer.from(caPem!.toString('utf8').replace(/-----[^-]+-----|\s/g, ''), 'base64')
    const result = importCaCertificate(new Uint8Array(der))
    expect(result.pem).toMatch(/^-----BEGIN CERTIFICATE-----/)
    expect(describeCertificate(new Uint8Array(der)).subject).toBe('CN=LDAP Studio Test CA')
  })
})

describe('certificate import errors', () => {
  it('rejects a file that is not a certificate', () => {
    expect(() => importCaCertificate(new TextEncoder().encode('not a certificate'))).toThrow(StorageError)
  })
})
