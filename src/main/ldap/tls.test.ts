import { describe, expect, it } from 'vitest'
import { describeAuthorizationError, normalizeFingerprint, tlsOptions, trustedCertificates } from './tls'

describe('normalizeFingerprint', () => {
  it('ignores case and separators', () => {
    expect(normalizeFingerprint('ab:cd:0f')).toBe('ABCD0F')
    expect(normalizeFingerprint('AB CD 0F')).toBe(normalizeFingerprint('abcd0f'))
  })
})

describe('describeAuthorizationError', () => {
  it('explains common verification failures and falls back to the code', () => {
    expect(describeAuthorizationError('CERT_HAS_EXPIRED')).toBe('The certificate has expired.')
    expect(describeAuthorizationError('ERR_TLS_CERT_ALTNAME_INVALID')).toContain('host name')
    expect(describeAuthorizationError('SOMETHING_NEW')).toContain('SOMETHING_NEW')
  })
})

describe('tlsOptions', () => {
  const verification = { ca: ['PEM'], host: 'ldap.example.com' }

  it('verifies itself instead of letting Node reject, and sets SNI for host names', () => {
    expect(tlsOptions(verification)).toEqual({
      ca: ['PEM'],
      rejectUnauthorized: false,
      servername: 'ldap.example.com',
    })
  })

  it('omits SNI for IP addresses', () => {
    expect(tlsOptions({ ...verification, host: '10.0.0.1' }).servername).toBeUndefined()
    expect(tlsOptions({ ...verification, host: '::1' }).servername).toBeUndefined()
  })

  it('returns a fresh object every time, because ldapts writes into it', () => {
    expect(tlsOptions(verification)).not.toBe(tlsOptions(verification))
  })
})

describe('trustedCertificates', () => {
  it('adds the profile CAs to the built-in and system roots', () => {
    const certificates = trustedCertificates(['PROFILE-CA'])
    expect(certificates.length).toBeGreaterThan(50)
    expect(certificates.at(-1)).toBe('PROFILE-CA')
  })
})
