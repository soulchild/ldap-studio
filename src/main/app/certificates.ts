/** Certificate file handling for CA import and certificate display (connection-management spec). */
import { X509Certificate } from 'node:crypto'
import type { CertificateInfo } from '@shared/ipc'
import { StorageError } from '../store/json-store'
import { certificateInfo } from '../ldap/tls'

/** Parses a DER or PEM certificate; throws a StorageError with a readable message otherwise. */
export function parseCertificate(bytes: Uint8Array): X509Certificate {
  try {
    return new X509Certificate(Buffer.from(bytes))
  } catch {
    throw new StorageError('This file is not an X.509 certificate in PEM or DER format.')
  }
}

export function toPem(certificate: X509Certificate): string {
  return certificate.toString().trim()
}

export function describeCertificate(bytes: Uint8Array): CertificateInfo {
  return certificateInfo(parseCertificate(bytes))
}

/** Reads a CA certificate file (PEM or DER). Only the first certificate of a PEM bundle is used. */
export function importCaCertificate(bytes: Uint8Array): { pem: string; info: CertificateInfo } {
  const certificate = parseCertificate(bytes)
  return { pem: toPem(certificate), info: certificateInfo(certificate) }
}
