import { describe, expect, it } from 'vitest'
import { diffEntry, valuesEqual, type AttributeValue, type EntryAttribute } from './entry'

const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function entry(attributes: Record<string, AttributeValue[]>): EntryAttribute[] {
  return Object.entries(attributes).map(([name, values]) => ({ name, values }))
}

const singleValued = new Set(['uidnumber', 'displayname'])
const options = { isSingleValued: (name: string) => singleValued.has(name.toLowerCase()) }

describe('valuesEqual', () => {
  it('compares strings exactly and bytes by content', () => {
    expect(valuesEqual('a', 'a')).toBe(true)
    expect(valuesEqual('a', 'A')).toBe(false)
    expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(valuesEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
    expect(valuesEqual('\u0001', new Uint8Array([1]))).toBe(false)
  })
})

describe('diffEntry', () => {
  it('returns no changes when nothing changed', () => {
    const original = entry({ cn: ['jdoe'], jpegPhoto: [photo] })
    const working = entry({ cn: ['jdoe'], jpegPhoto: [new Uint8Array(photo)] })
    expect(diffEntry(original, working, options)).toEqual([])
  })

  it('replaces single-valued attributes', () => {
    const changes = diffEntry(entry({ uidNumber: ['1000'] }), entry({ uidNumber: ['1001'] }), options)
    expect(changes).toEqual([{ operation: 'replace', attribute: 'uidNumber', values: ['1001'] }])
  })

  it('adds and deletes individual values of multi-valued attributes', () => {
    const changes = diffEntry(
      entry({ mail: ['a@x', 'b@x', 'c@x'] }),
      entry({ mail: ['a@x', 'c@x', 'd@x'] }),
      options,
    )
    expect(changes).toEqual([
      { operation: 'delete', attribute: 'mail', values: ['b@x'] },
      { operation: 'add', attribute: 'mail', values: ['d@x'] },
    ])
  })

  it('replaces a multi-valued attribute when every original value changed', () => {
    const changes = diffEntry(entry({ mail: ['a@x'] }), entry({ mail: ['b@x', 'c@x'] }), options)
    expect(changes).toEqual([{ operation: 'replace', attribute: 'mail', values: ['b@x', 'c@x'] }])
  })

  it('deletes an attribute that was removed or emptied', () => {
    expect(diffEntry(entry({ cn: ['x'], telephoneNumber: ['1'] }), entry({ cn: ['x'] }), options)).toEqual([
      { operation: 'delete', attribute: 'telephoneNumber', values: [] },
    ])
    expect(
      diffEntry(entry({ telephoneNumber: ['1', '2'] }), entry({ telephoneNumber: [] }), options),
    ).toEqual([{ operation: 'delete', attribute: 'telephoneNumber', values: [] }])
  })

  it('adds new attributes and ignores new empty ones', () => {
    expect(
      diffEntry(entry({ cn: ['x'] }), entry({ cn: ['x'], mail: ['m@x'], description: [] }), options),
    ).toEqual([{ operation: 'add', attribute: 'mail', values: ['m@x'] }])
  })

  it('compares binary values by bytes', () => {
    const otherPhoto = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9])
    expect(diffEntry(entry({ jpegPhoto: [photo] }), entry({ jpegPhoto: [otherPhoto] }), options)).toEqual([
      { operation: 'replace', attribute: 'jpegPhoto', values: [otherPhoto] },
    ])
  })

  it('leaves untouched attributes, including binary ones, out of the change list', () => {
    const original = entry({ cn: ['jdoe'], mail: ['old@x'], jpegPhoto: [photo], userCertificate: [photo] })
    const working = entry({ cn: ['jdoe'], mail: ['new@x'], jpegPhoto: [photo], userCertificate: [photo] })
    const changes = diffEntry(original, working, options)
    expect(changes).toEqual([{ operation: 'replace', attribute: 'mail', values: ['new@x'] }])
    expect(changes.some((change) => change.attribute === 'jpegPhoto')).toBe(false)
  })

  it('matches attribute names case-insensitively', () => {
    expect(diffEntry(entry({ Mail: ['a@x'] }), entry({ mail: ['a@x'] }), options)).toEqual([])
    expect(diffEntry(entry({ DisplayName: ['A'] }), entry({ displayname: ['B'] }), options)).toEqual([
      { operation: 'replace', attribute: 'displayname', values: ['B'] },
    ])
  })

  it('treats a value whose case changed as a different value', () => {
    expect(diffEntry(entry({ cn: ['Doe', 'x'] }), entry({ cn: ['doe', 'x'] }), options)).toEqual([
      { operation: 'delete', attribute: 'cn', values: ['Doe'] },
      { operation: 'add', attribute: 'cn', values: ['doe'] },
    ])
  })

  it('combines several kinds of change in one list', () => {
    const changes = diffEntry(
      entry({ mail: ['a@x'], telephoneNumber: ['1'], description: ['d1', 'd2'] }),
      entry({ mail: ['b@x'], description: ['d1'], title: ['Eng'] }),
      options,
    )
    expect(changes).toEqual([
      { operation: 'replace', attribute: 'mail', values: ['b@x'] },
      { operation: 'delete', attribute: 'telephoneNumber', values: [] },
      { operation: 'delete', attribute: 'description', values: ['d2'] },
      { operation: 'add', attribute: 'title', values: ['Eng'] },
    ])
  })

  it('replaces attributes that cannot be changed value by value', () => {
    const second = new Uint8Array([0x89, 0x50])
    const changes = diffEntry(entry({ jpegPhoto: [photo] }), entry({ jpegPhoto: [photo, second] }), {
      replaceOnly: (name) => name === 'jpegPhoto',
    })
    expect(changes).toEqual([{ operation: 'replace', attribute: 'jpegPhoto', values: [photo, second] }])
  })
})
