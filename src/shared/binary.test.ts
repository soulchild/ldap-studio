import { describe, expect, it } from 'vitest'
import {
  classifyBinary,
  describeBinary,
  formatByteSize,
  formatGuid,
  formatSid,
  hexPreview,
  sniffImageType,
} from './binary'

/** Fixtures computed independently with Python's uuid.bytes_le and struct packing. */
function bytes(hex: string): Uint8Array {
  return new Uint8Array(hex.split(' ').map((h) => parseInt(h, 16)))
}

const GUID_BYTES = bytes('ff 19 96 6f 86 8b 11 d0 b4 2d 00 c0 4f c9 64 ff')
const DOMAIN_SID = bytes(
  '01 05 00 00 00 00 00 05 15 00 00 00 dc f4 dc 3b 83 3d 2b 46 82 8b a6 28 00 02 00 00',
)
const ADMINISTRATORS_SID = bytes('01 02 00 00 00 00 00 05 20 00 00 00 20 02 00 00')
const EVERYONE_SID = bytes('01 01 00 00 00 00 00 01 00 00 00 00')

describe('formatGuid', () => {
  it('formats AD objectGUID with little-endian leading groups', () => {
    expect(formatGuid(GUID_BYTES)).toBe('6f9619ff-8b86-d011-b42d-00c04fc964ff')
  })

  it('rejects values that are not 16 bytes', () => {
    expect(formatGuid(new Uint8Array(15))).toBeUndefined()
  })
})

describe('formatSid', () => {
  it.each([
    [DOMAIN_SID, 'S-1-5-21-1004336348-1177238915-682003330-512'],
    [ADMINISTRATORS_SID, 'S-1-5-32-544'],
    [EVERYONE_SID, 'S-1-1-0'],
  ])('formats %#', (input, expected) => {
    expect(formatSid(input)).toBe(expected)
  })

  it('works on a view into a larger buffer', () => {
    const padded = new Uint8Array(ADMINISTRATORS_SID.length + 3)
    padded.set(ADMINISTRATORS_SID, 3)
    expect(formatSid(padded.subarray(3))).toBe('S-1-5-32-544')
  })

  it('rejects truncated or inconsistent values', () => {
    expect(formatSid(new Uint8Array(4))).toBeUndefined()
    expect(formatSid(ADMINISTRATORS_SID.slice(0, 14))).toBeUndefined()
  })
})

describe('sniffImageType', () => {
  it('detects JPEG, PNG and GIF by magic bytes', () => {
    expect(sniffImageType(bytes('ff d8 ff e0 00 10'))).toBe('jpeg')
    expect(sniffImageType(bytes('89 50 4e 47 0d 0a 1a 0a 00'))).toBe('png')
    expect(sniffImageType(new TextEncoder().encode('GIF89a...'))).toBe('gif')
    expect(sniffImageType(bytes('30 82 01 0a'))).toBeUndefined()
  })
})

describe('formatByteSize', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1023 bytes'],
    [1536, '1.5 KB'],
    [12 * 1024 + 100, '12 KB'],
    [3.24 * 1024 * 1024, '3.2 MB'],
  ])('formats %d as %s', (size, expected) => {
    expect(formatByteSize(size)).toBe(expected)
  })
})

describe('hexPreview', () => {
  it('shows all bytes when short', () => {
    expect(hexPreview(bytes('00 0a ff'))).toBe('00 0a ff')
  })

  it('truncates long values and says how much is hidden', () => {
    expect(hexPreview(new Uint8Array(40), 4)).toBe('00 00 00 00 … (+36 bytes)')
  })
})

describe('classifyBinary and describeBinary', () => {
  it('uses the attribute name for GUID, SID and certificates', () => {
    expect(classifyBinary('objectGUID', GUID_BYTES)).toBe('guid')
    expect(classifyBinary('objectSid', DOMAIN_SID)).toBe('sid')
    expect(classifyBinary('userCertificate;binary', bytes('30 82'))).toBe('certificate')
  })

  it('falls back to sniffing and then to generic binary', () => {
    expect(classifyBinary('jpegPhoto', bytes('ff d8 ff e0'))).toBe('image')
    expect(classifyBinary('thumbnailPhoto', bytes('89 50 4e 47 0d 0a 1a 0a'))).toBe('image')
    expect(classifyBinary('objectGUID', new Uint8Array(3))).toBe('other')
    expect(classifyBinary('someBlob', bytes('01 02'))).toBe('other')
  })

  it('describes values without exposing raw bytes', () => {
    const jpeg = new Uint8Array(12 * 1024)
    jpeg.set([0xff, 0xd8, 0xff])
    expect(describeBinary('jpegPhoto', jpeg)).toBe('JPEG image, 12 KB')
    expect(describeBinary('objectSid', ADMINISTRATORS_SID)).toBe('S-1-5-32-544')
    expect(describeBinary('objectGUID', GUID_BYTES)).toBe('6f9619ff-8b86-d011-b42d-00c04fc964ff')
    expect(describeBinary('userCertificate', new Uint8Array(900))).toBe('Certificate, 900 bytes')
    expect(describeBinary('blob', new Uint8Array(2048))).toBe('Binary, 2 KB')
  })
})
