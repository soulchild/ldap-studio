import { describe, expect, it } from 'vitest'
import type { SchemaSnapshot } from '@shared/schema'
import { SchemaModel } from '@shared/schema-model'
import {
  addableAttributes,
  addAttribute,
  addValue,
  changedAttributeCount,
  changes,
  cleaned,
  isChanged,
  isNewValue,
  removeAttribute,
  removeValue,
  requiredAttributes,
  setValue,
  validate,
  type Working,
} from './model'

const type = (name: string, extra: Partial<SchemaSnapshot['attributeTypes'][number]> = {}) => ({
  oid: `1.1.${name}`,
  names: [name],
  obsolete: false,
  singleValue: false,
  collective: false,
  noUserModification: false,
  usage: 'userApplications' as const,
  syntax: '1.3.6.1.4.1.1466.115.121.1.15',
  equality: 'caseIgnoreMatch',
  ...extra,
})

const schema = new SchemaModel({
  attributeTypes: [
    type('objectClass'),
    type('cn'),
    type('sn'),
    type('mail'),
    type('telephoneNumber'),
    type('uidNumber', { singleValue: true }),
    type('modifyTimestamp', { noUserModification: true, usage: 'directoryOperation' }),
  ],
  objectClasses: [
    {
      oid: '2.5.6.0',
      names: ['top'],
      obsolete: false,
      sup: [],
      kind: 'abstract',
      must: ['objectClass'],
      may: [],
    },
    {
      oid: '2.5.6.6',
      names: ['person'],
      obsolete: false,
      sup: ['top'],
      kind: 'structural',
      must: ['cn', 'sn'],
      may: ['telephoneNumber', 'mail', 'uidNumber', 'modifyTimestamp'],
    },
  ],
  syntaxes: [],
})

const original: Working = [
  { name: 'objectClass', values: ['top', 'person'] },
  { name: 'cn', values: ['John Doe'] },
  { name: 'sn', values: ['Doe'] },
  { name: 'mail', values: ['a@x', 'b@x'] },
]

describe('editing values', () => {
  it('changes, adds and removes values', () => {
    let working = setValue(original, 'mail', 0, 'c@x')
    working = addValue(working, 'MAIL', 'd@x')
    working = removeValue(working, 'mail', 1)
    expect(working.find((a) => a.name === 'mail')?.values).toEqual(['c@x', 'd@x'])
    expect(original.find((a) => a.name === 'mail')?.values).toEqual(['a@x', 'b@x'])
  })

  it('removes an attribute when its last value is removed', () => {
    expect(removeValue(original, 'sn', 0).some((a) => a.name === 'sn')).toBe(false)
  })

  it('adds a new attribute with an empty value, or a value to an existing one', () => {
    expect(addAttribute(original, 'telephoneNumber').at(-1)).toEqual({
      name: 'telephoneNumber',
      values: [''],
    })
    expect(addAttribute(original, 'mail').find((a) => a.name === 'mail')?.values).toEqual(['a@x', 'b@x', ''])
  })

  it('treats empty text values as removed when saving', () => {
    const working = setValue(addAttribute(original, 'telephoneNumber'), 'cn', 0, '  ')
    expect(cleaned(working).map((a) => a.name)).toEqual(['objectClass', 'sn', 'mail'])
  })
})

describe('changes', () => {
  it('builds the modify list, replacing single-valued attributes', () => {
    let working = setValue(original, 'sn', 0, 'Smith')
    working = removeValue(working, 'mail', 0)
    working = addAttribute(working, 'uidNumber')
    working = setValue(working, 'uidNumber', 0, '1000')
    expect(changes(original, working, schema)).toEqual([
      { operation: 'replace', attribute: 'sn', values: ['Smith'] },
      { operation: 'delete', attribute: 'mail', values: ['a@x'] },
      { operation: 'add', attribute: 'uidNumber', values: ['1000'] },
    ])
  })

  it('ignores an attribute added but left empty', () => {
    expect(changes(original, addAttribute(original, 'telephoneNumber'), schema)).toEqual([])
  })

  it('removes a whole attribute', () => {
    expect(changes(original, removeAttribute(original, 'mail'), schema)).toEqual([
      { operation: 'delete', attribute: 'mail', values: [] },
    ])
  })
})

describe('schema checks', () => {
  it('lists the required attributes of the object classes', () => {
    expect(requiredAttributes(original, schema)).toEqual(['objectClass', 'cn', 'sn'])
  })

  it('blocks removing a required attribute', () => {
    expect(validate(removeValue(original, 'sn', 0), schema).get('sn')).toBe(
      "sn is required by the entry's object classes.",
    )
    expect(validate(setValue(original, 'sn', 0, ''), schema).has('sn')).toBe(true)
  })

  it('blocks a second value on a single-valued attribute', () => {
    const working = addValue(
      addValue(addAttribute(original, 'uidNumber'), 'uidNumber', '2'),
      'uidNumber',
      '3',
    )
    expect(validate(working, schema).get('uidNumber')).toBe('uidNumber can only have one value.')
  })

  it('accepts a valid entry', () => {
    expect(validate(original, schema).size).toBe(0)
  })

  it('offers only allowed, absent, user-modifiable attributes to add', () => {
    expect(addableAttributes(original, schema)).toEqual(['telephoneNumber', 'uidNumber'])
  })
})

describe('pending markers', () => {
  it('marks changed attributes and new values', () => {
    const working = setValue(original, 'mail', 1, 'z@x')
    expect(isChanged(original, working, 'mail')).toBe(true)
    expect(isChanged(original, working, 'cn')).toBe(false)
    expect(isNewValue(original, 'mail', 'z@x')).toBe(true)
    expect(isNewValue(original, 'mail', 'a@x')).toBe(false)
  })

  it('does not mark an attribute whose values were only reordered or emptied and refilled', () => {
    const working = setValue(setValue(original, 'mail', 0, 'b@x'), 'mail', 1, 'a@x')
    expect(isChanged(original, working, 'mail')).toBe(false)
  })
})

describe('changedAttributeCount', () => {
  it('counts attributes, not operations', () => {
    const working = removeAttribute(setValue(addValue(original, 'mail', 'c@x'), 'mail', 0, 'z@x'), 'cn')
    const modifications = changes(original, working, schema)
    expect(modifications.length).toBeGreaterThan(2)
    expect(changedAttributeCount(modifications)).toBe(2)
  })
})

describe('attributes without an equality rule', () => {
  it('are replaced as a whole, because servers refuse single-value changes for them', () => {
    const photoSchema = new SchemaModel({
      ...schema.snapshot,
      attributeTypes: [
        ...schema.snapshot.attributeTypes,
        type('jpegPhoto', { equality: undefined, syntax: '1.3.6.1.4.1.1466.115.121.1.28' }),
      ],
    })
    const first = new Uint8Array([0xff, 0xd8, 0xff])
    const second = new Uint8Array([0x89, 0x50])
    const before: Working = [...original, { name: 'jpegPhoto', values: [first] }]
    expect(changes(before, addValue(before, 'jpegPhoto', second), photoSchema)).toEqual([
      { operation: 'replace', attribute: 'jpegPhoto', values: [first, second] },
    ])
  })
})
