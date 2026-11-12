/**
 * TLS for LDAPS and StartTLS (design §6). We verify certificates ourselves in `secureConnect`
 * so we can report the certificate on failure and honour a pinned fingerprint, and we destroy
 * the socket there so nothing, not even the bind, is sent over an untrusted connection.
 */
import type { X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import tls from 'node:tls'
import type { AppError, CertificateInfo } from '@shared/ipc'

/** Bundled Mozilla roots plus the operating system's trust store (company CAs), plus the profile's own. */
export function trustedCertificates(profileCaCertificates: string[]): string[] {
  const getCa = (tls as { getCACertificates?: (type: string) => string[] }).getCACertificates
  const builtIn = getCa ? [...getCa('bundled'), ...getCa('system')] : [...tls.rootCertificates]
  return [...builtIn, ...profileCaCertificates]
}

export function certificateInfo(certificate: X509Certificate): CertificateInfo {
  return {
    subject: certificate.subject.replace(/\n/g, ', '),
    issuer: certificate.issuer.replace(/\n/g, ', '),
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
    serialNumber: certificate.serialNumber,
    fingerprint256: certificate.fingerprint256,
  }
}

/** Fingerprints compare case-insensitively and with or without colons. */
export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/[^0-9a-f]/gi, '').toUpperCase()
}

const REASONS: Record<string, string> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The certificate is self-signed.',
  SELF_SIGNED_CERT_IN_CHAIN: 'The certificate was issued by a certificate authority that is not trusted.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The certificate was issued by an unknown certificate authority.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The certificate was issued by an unknown certificate authority.',
  CERT_HAS_EXPIRED: 'The certificate has expired.',
  CERT_NOT_YET_VALID: 'The certificate is not valid yet.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The certificate is not valid for this host name.',
}

export function describeAuthorizationError(code: string): string {
  return REASONS[code] ?? `The certificate could not be verified (${code}).`
}

export interface TlsVerification {
  /** CA certificates to verify against, from `trustedCertificates`. */
  ca: string[]
  host: string
  pinnedFingerprint?: string | undefined
}

/**
 * Holds the reason a TLS connection was refused, so the session can report it instead of
 * the generic socket error ldapts sees after we destroy the socket.
 */
export interface TlsRejection {
  error?: AppError
}

/** Options for one connection; always a fresh object (ldapts' startTLS writes into it). */
export function tlsOptions(verification: TlsVerification): tls.ConnectionOptions {
  const options: tls.ConnectionOptions = { ca: verification.ca, rejectUnauthorized: false }
  if (!isIP(verification.host)) {
    options.servername = verification.host
  }
  return options
}

/**
 * A `tls.connect` replacement for ldapts' `createSecureConnection`. Accepts the server when its
 * chain is trusted and the host name matches, or else when its leaf certificate matches the
 * pinned fingerprint. A pinned certificate that was replaced by one that verifies normally is
 * accepted too, as the connection-management spec requires.
 */
export function verifyingConnect(verification: TlsVerification, rejection: TlsRejection): typeof tls.connect {
  return ((...args: unknown[]) => {
    const socket = (tls.connect as (...connectArgs: unknown[]) => tls.TLSSocket)(...args)
    socket.once('secureConnect', () => {
      if (socket.authorized) {
        return
      }
      const certificate = socket.getPeerX509Certificate()
      const pinned = verification.pinnedFingerprint
      if (
        certificate &&
        pinned &&
        normalizeFingerprint(certificate.fingerprint256) === normalizeFingerprint(pinned)
      ) {
        return
      }
      rejection.error = certificate
        ? {
            kind: 'certificateUntrusted',
            message: pinned
              ? 'The server certificate differs from the one you trusted.'
              : 'The server certificate is not trusted.',
            reason: describeAuthorizationError(String(socket.authorizationError ?? 'UNKNOWN')),
            certificate: certificateInfo(certificate),
            fingerprintMismatch: pinned !== undefined,
          }
        : { kind: 'tls', message: 'The server did not present a certificate.' }
      socket.destroy(new Error('TLS certificate rejected'))
    })
    return socket
  }) as typeof tls.connect
}
