/** Pure formatters for binary attribute values. Certificates are decoded in main (see design §12). */

/**
 * Formats an Active Directory `objectGUID` in its usual string form. AD stores the
 * first three groups little-endian, so `ff 19 96 6f 86 8b 11 d0 ...` becomes
 * `6f9619ff-8b86-d011-...`.
 */
export function formatGuid(bytes: Uint8Array): string | undefined {
  if (bytes.length !== 16) {
    return undefined
  }
  const hex = (indices: number[]) => indices.map((i) => toHex(bytes[i] ?? 0)).join('')
  return [hex([3, 2, 1, 0]), hex([5, 4]), hex([7, 6]), hex([8, 9]), hex([10, 11, 12, 13, 14, 15])].join('-')
}

/** Formats a binary security identifier (`objectSid`) as `S-1-5-21-...`. */
export function formatSid(bytes: Uint8Array): string | undefined {
  if (bytes.length < 8) {
    return undefined
  }
  const revision = bytes[0] ?? 0
  const subAuthorityCount = bytes[1] ?? 0
  if (bytes.length !== 8 + subAuthorityCount * 4) {
    return undefined
  }
  let authority = 0
  for (let i = 2; i < 8; i++) {
    authority = authority * 256 + (bytes[i] ?? 0)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const subAuthorities: number[] = []
  for (let i = 0; i < subAuthorityCount; i++) {
    subAuthorities.push(view.getUint32(8 + i * 4, true))
  }
  return ['S', revision, authority, ...subAuthorities].join('-')
}

export type ImageType = 'jpeg' | 'png' | 'gif'

/** Detects an image by its magic bytes, regardless of which attribute holds it. */
export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) {
    return 'png'
  }
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))) {
    return 'gif'
  }
  return undefined
}

export const IMAGE_MIME_TYPES: Record<ImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
}

/** Human-readable size in binary units: `512 bytes`, `1.5 KB`, `12 KB`, `3.2 MB`. */
export function formatByteSize(size: number): string {
  if (size === 1) {
    return '1 byte'
  }
  if (size < 1024) {
    return `${size} bytes`
  }
  const units = ['KB', 'MB', 'GB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded} ${units[unit]}`
}

/** Space-separated hex of the first `maxBytes` bytes, with a note on how many were left out. */
export function hexPreview(bytes: Uint8Array, maxBytes = 32): string {
  const shown = Array.from(bytes.slice(0, maxBytes), toHex).join(' ')
  const rest = bytes.length - maxBytes
  return rest > 0 ? `${shown} … (+${formatByteSize(rest)})` : shown
}

/** Well-known attributes whose binary values have a dedicated string form. */
export type BinaryKind = 'image' | 'certificate' | 'guid' | 'sid' | 'other'

const CERTIFICATE_ATTRIBUTES = new Set(['usercertificate', 'cacertificate', 'crosscertificatepair'])
const GUID_ATTRIBUTES = new Set(['objectguid', 'msexchmailboxguid', 'msds-consistencyguid'])
const SID_ATTRIBUTES = new Set(['objectsid', 'sidhistory', 'securityidentifier', 'tokengroups'])

/** Picks how to present a binary value, from the attribute name first and the bytes second. */
export function classifyBinary(attribute: string, bytes: Uint8Array): BinaryKind {
  const name = (attribute.split(';')[0] ?? attribute).toLowerCase()
  if (CERTIFICATE_ATTRIBUTES.has(name)) {
    return 'certificate'
  }
  if (GUID_ATTRIBUTES.has(name) && bytes.length === 16) {
    return 'guid'
  }
  if (SID_ATTRIBUTES.has(name) && formatSid(bytes) !== undefined) {
    return 'sid'
  }
  if (sniffImageType(bytes)) {
    return 'image'
  }
  return 'other'
}

/** One-line description for tables and logs, e.g. `JPEG image, 12 KB`. Never contains raw bytes. */
export function describeBinary(attribute: string, bytes: Uint8Array): string {
  const size = formatByteSize(bytes.length)
  switch (classifyBinary(attribute, bytes)) {
    case 'image':
      return `${sniffImageType(bytes)?.toUpperCase()} image, ${size}`
    case 'certificate':
      return `Certificate, ${size}`
    case 'guid':
      return formatGuid(bytes) ?? `Binary, ${size}`
    case 'sid':
      return formatSid(bytes) ?? `Binary, ${size}`
    default:
      return `Binary, ${size}`
  }
}

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}
