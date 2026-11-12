import { describe, expect, it } from 'vitest'
import { SchemaModel } from '@shared/schema-model'
import { attributeListSuggestions, filterDiagnostics, filterSuggestions, parseAttributeList } from './assist'

const type = (name: string, ...aliases: string[]) => ({
  oid: `1.1.${name}`,
  names: [name, ...aliases],
  obsolete: false,
  singleValue: false,
  collective: false,
  noUserModification: false,
  usage: 'userApplications' as const,
})
const objectClass = (name: string) => ({
  oid: `2.2.${name}`,
  names: [name],
  obsolete: false,
  sup: [],
  kind: 'structural' as const,
  must: [],
  may: [],
})
const schema = new SchemaModel({
  attributeTypes: [type('mail'), type('member'), type('cn', 'commonName'), type('objectClass')],
  objectClasses: [objectClass('inetOrgPerson'), objectClass('groupOfNames')],
  syntaxes: [],
})

describe('filterSuggestions', () => {
  it('suggests attributes while an attribute is typed', () => {
    expect(filterSuggestions('(ma', 3, schema)).toEqual({ from: 1, options: ['mail'] })
    expect(filterSuggestions('(&(uid=a)(m', 11, schema)).toEqual({ from: 10, options: ['mail', 'member'] })
  })

  it('suggests object classes in an objectClass value', () => {
    expect(filterSuggestions('(objectClass=inet', 17, schema)).toEqual({
      from: 13,
      options: ['inetOrgPerson'],
    })
  })

  it('suggests nothing inside other values', () => {
    expect(filterSuggestions('(cn=jo', 6, schema)).toBeUndefined()
  })
})

describe('attributeListSuggestions', () => {
  it('completes the name being typed after a comma', () => {
    expect(attributeListSuggestions('cn, ma', 6, schema)).toEqual({ from: 4, options: ['mail'] })
    expect(attributeListSuggestions('co', 2, schema)).toEqual({ from: 0, options: ['commonName'] })
  })

  it('splits the list on commas and spaces', () => {
    expect(parseAttributeList(' cn, mail  member,')).toEqual(['cn', 'mail', 'member'])
  })
})

describe('filterDiagnostics', () => {
  it('marks a syntax error at its position', () => {
    const [error] = filterDiagnostics('(&(uid=jdoe)(mail=*)', schema, true)
    expect(error).toMatchObject({ severity: 'error', message: expect.stringContaining('Missing ")"') })
    expect(error!.from).toBe(19)
  })

  it('warns about attributes the schema does not know, without blocking', () => {
    expect(filterDiagnostics('(&(mail=*)(shoeSize=42))', schema, true)).toEqual([
      { from: 11, to: 19, severity: 'warning', message: "shoeSize is not in the server's schema." },
    ])
  })

  it('does not warn when the schema is unavailable, and accepts an empty field', () => {
    expect(filterDiagnostics('(shoeSize=42)', schema, false)).toEqual([])
    expect(filterDiagnostics('  ', schema, true)).toEqual([])
  })

  it('accepts aliases and attribute options', () => {
    expect(filterDiagnostics('(&(commonName=a)(cn;lang-en=b))', schema, true)).toEqual([])
  })
})
