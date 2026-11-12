import { describe, expect, it } from 'vitest'
import { decodeEntry, decodeValue, EveryAttribute, hasBinaryOption } from './values'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])

describe('EveryAttribute', () => {
  it('claims to include every name', () => {
    expect(new EveryAttribute().includes()).toBe(true)
  })
})

describe('decodeValue', () => {
  it('decodes valid UTF-8 as text', () => {
    expect(decodeValue(Buffer.from('Jürgen', 'utf8'), false)).toBe('Jürgen')
  })

  it('keeps invalid UTF-8 as bytes', () => {
    const value = decodeValue(jpeg, false)
    expect(value).toBeInstanceOf(Uint8Array)
    expect(Array.from(value as Uint8Array)).toEqual(Array.from(jpeg))
  })

  it('keeps binary attributes as bytes even when they happen to be valid UTF-8', () => {
    expect(decodeValue(Buffer.from('abc'), true)).toEqual(new Uint8Array([0x61, 0x62, 0x63]))
  })

  it('copies bytes out of a shared buffer pool', () => {
    const pool = Buffer.alloc(8192, 0x41)
    jpeg.copy(pool, 100)
    const view = pool.subarray(100, 105)
    const value = decodeValue(view, true) as Uint8Array
    expect(value.byteLength).toBe(5)
    expect(value.buffer.byteLength).toBe(5)
  })
})

describe('hasBinaryOption', () => {
  it('detects the ;binary option in any position and case', () => {
    expect(hasBinaryOption('userCertificate;binary')).toBe(true)
    expect(hasBinaryOption('userCertificate;lang-en;BINARY')).toBe(true)
    expect(hasBinaryOption('userCertificate')).toBe(false)
    expect(hasBinaryOption('binary')).toBe(false)
  })
})

describe('decodeEntry', () => {
  it('splits the DN from the attributes and decodes each value', () => {
    const entry = decodeEntry(
      {
        dn: 'uid=jdoe,dc=x',
        cn: [Buffer.from('John Doe')],
        jpegPhoto: jpeg,
        'userCertificate;binary': Buffer.from('0\u0082'),
        description: Buffer.from('text'),
      },
      (name) => name.toLowerCase() === 'description',
    )
    expect(entry.dn).toBe('uid=jdoe,dc=x')
    expect(entry.attributes.map((a) => a.name)).toEqual([
      'cn',
      'jpegPhoto',
      'userCertificate;binary',
      'description',
    ])
    expect(entry.attributes[0]?.values).toEqual(['John Doe'])
    expect(entry.attributes[1]?.values[0]).toBeInstanceOf(Uint8Array)
    expect(entry.attributes[2]?.values[0]).toBeInstanceOf(Uint8Array)
    expect(entry.attributes[3]?.values[0]).toBeInstanceOf(Uint8Array)
  })
})
