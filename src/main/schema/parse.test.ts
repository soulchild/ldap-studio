import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAttributeType, parseObjectClass, parseSubschema, parseSyntax, type RawSubschema } from './parse'

function fixture(name: string): RawSubschema {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'),
  ) as RawSubschema
}

const find = <T extends { names: string[] }>(items: T[], name: string) =>
  items.find((item) => item.names.some((candidate) => candidate.toLowerCase() === name.toLowerCase()))

describe.each([
  ['OpenLDAP', 'openldap'],
  ['389-DS', '389ds'],
  ['Active Directory sample', 'ad-sample'],
])('parsing the %s schema', (_label, name) => {
  const raw = fixture(name)
  const { snapshot, warnings } = parseSubschema(raw)

  it('parses every definition without warnings', () => {
    expect(warnings).toEqual([])
    expect(snapshot.attributeTypes).toHaveLength(raw.attributeTypes.length)
    expect(snapshot.objectClasses).toHaveLength(raw.objectClasses.length)
    expect(snapshot.syntaxes).toHaveLength(raw.ldapSyntaxes.length)
  })

  it('finds the core definitions', () => {
    expect(find(snapshot.objectClasses, 'top')?.kind).toBe('abstract')
    expect(find(snapshot.attributeTypes, 'objectClass')).toBeDefined()
    expect(find(snapshot.attributeTypes, 'cn')).toBeDefined()
  })
})

describe('parsing OpenLDAP and 389-DS specifics', () => {
  const openldap = parseSubschema(fixture('openldap')).snapshot
  const ds389 = parseSubschema(fixture('389ds')).snapshot

  it('reads inetOrgPerson with its superior and optional attributes', () => {
    const inetOrgPerson = find(openldap.objectClasses, 'inetOrgPerson')
    expect(inetOrgPerson).toMatchObject({
      oid: '2.16.840.1.113730.3.2.2',
      sup: ['organizationalPerson'],
      kind: 'structural',
    })
    expect(inetOrgPerson?.may).toEqual(
      expect.arrayContaining(['mail', 'uid', 'jpegPhoto', 'userCertificate']),
    )
  })

  it('reads multiple names and the attribute superior', () => {
    expect(find(ds389.attributeTypes, 'commonName')).toMatchObject({
      names: ['cn', 'commonName'],
      sup: 'name',
    })
  })

  it('reads operational attributes as not user-modifiable with their usage', () => {
    expect(find(openldap.attributeTypes, 'modifyTimestamp')).toMatchObject({
      noUserModification: true,
      singleValue: true,
      usage: 'directoryOperation',
    })
  })

  it('reads auxiliary classes and MUST lists', () => {
    expect(find(openldap.objectClasses, 'posixAccount')).toMatchObject({
      kind: 'auxiliary',
      must: expect.arrayContaining(['cn', 'uid', 'uidNumber', 'gidNumber', 'homeDirectory']),
    })
  })
})

describe('parsing Active Directory specifics', () => {
  const ad = parseSubschema(fixture('ad-sample')).snapshot

  it('accepts SYNTAX OIDs in quotes', () => {
    expect(find(ad.attributeTypes, 'objectGUID')).toMatchObject({
      syntax: '1.3.6.1.4.1.1466.115.121.1.40',
      singleValue: true,
      noUserModification: true,
    })
  })

  it('accepts lists without a space after the opening parenthesis', () => {
    expect(find(ad.objectClasses, 'top')?.must).toEqual([
      'objectClass',
      'instanceType',
      'nTSecurityDescriptor',
      'objectCategory',
    ])
    expect(find(ad.objectClasses, 'group')?.must).toEqual(['groupType'])
  })
})

describe('definition details', () => {
  it('strips a length bound from the syntax', () => {
    expect(
      parseAttributeType("( 2.5.4.3 NAME 'cn' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15{32768} )").syntax,
    ).toBe('1.3.6.1.4.1.1466.115.121.1.15')
  })

  it('decodes escaped quotes and backslashes in descriptions', () => {
    expect(parseObjectClass("( 1.2.3 NAME 'x' DESC 'It\\27s a \\5C test' )").description).toBe(
      "It's a \\ test",
    )
  })

  it('skips extension keywords with values, and unknown flags', () => {
    expect(
      parseAttributeType(
        "( 1.2.3 NAME 'x' X-ORIGIN ( 'RFC 1' 'local' ) X-DEPRECATED 'old' EQUALITY caseIgnoreMatch SINGLE-VALUE )",
      ),
    ).toMatchObject({ names: ['x'], equality: 'caseIgnoreMatch', singleValue: true })
    expect(parseObjectClass("( 1.2.3 NAME 'y' SOMEFLAG MUST cn )")).toMatchObject({ must: ['cn'] })
  })

  it('treats a class without a kind as structural', () => {
    expect(parseObjectClass("( 1.2.3 NAME 'z' SUP top )").kind).toBe('structural')
  })

  it('reads syntax descriptions', () => {
    expect(parseSyntax("( 1.3.6.1.4.1.1466.115.121.1.15 DESC 'Directory String' )")).toEqual({
      oid: '1.3.6.1.4.1.1466.115.121.1.15',
      description: 'Directory String',
    })
  })

  it('skips a malformed definition with a warning and keeps the rest', () => {
    const { snapshot, warnings } = parseSubschema({
      attributeTypes: ["( 1.2.3 NAME 'ok' )", "( 1.2.4 NAME 'broken", "NAME 'no-paren'"],
      objectClasses: [],
      ldapSyntaxes: [],
    })
    expect(snapshot.attributeTypes.map((type) => type.names[0])).toEqual(['ok'])
    expect(warnings).toHaveLength(2)
  })
})
