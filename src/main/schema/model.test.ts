import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { schemaSnapshotSchema } from '@shared/schema'
import { SchemaModel } from '@shared/schema-model'
import { parseSubschema, type RawSubschema } from './parse'

function model(name: string): SchemaModel {
  const raw = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'),
  ) as RawSubschema
  return new SchemaModel(parseSubschema(raw).snapshot)
}

const openldap = model('openldap')
const ds389 = model('389ds')
const ad = model('ad-sample')

describe.each([
  ['OpenLDAP', openldap],
  ['389-DS', ds389],
])('SchemaModel on %s', (_label, schema) => {
  it('inherits required attributes along the superior chain of inetOrgPerson', () => {
    const { required, optional } = schema.allowedAttributes(['inetOrgPerson'])
    expect(required).toEqual(expect.arrayContaining(['objectClass', 'cn', 'sn']))
    expect(optional).toEqual(expect.arrayContaining(['mail', 'telephoneNumber', 'givenName']))
    expect(optional).not.toContain('cn')
  })

  it('combines a structural and an auxiliary class', () => {
    const { required } = schema.allowedAttributes(['inetOrgPerson', 'posixAccount'])
    expect(required).toEqual(
      expect.arrayContaining(['cn', 'sn', 'uid', 'uidNumber', 'gidNumber', 'homeDirectory']),
    )
  })

  it('looks up names, aliases and OIDs case-insensitively', () => {
    const cn = schema.attributeType('cn')
    expect(schema.attributeType('CommonName')).toBe(cn)
    expect(schema.attributeType('COMMONNAME')).toBe(cn)
    expect(schema.attributeType('2.5.4.3')).toBe(cn)
    expect(schema.canonicalAttributeName('commonname')).toBe('cn')
    expect(schema.objectClass('INETORGPERSON')?.oid).toBe('2.16.840.1.113730.3.2.2')
  })

  it('reports value counts, modifiability and usage', () => {
    expect(schema.isSingleValued('uidNumber')).toBe(true)
    expect(schema.isSingleValued('mail')).toBe(false)
    expect(schema.isUserModifiable('modifyTimestamp')).toBe(false)
    expect(schema.isUserModifiable('mail')).toBe(true)
    expect(schema.isOperational('modifyTimestamp')).toBe(true)
    expect(schema.isOperational('mail')).toBe(false)
  })

  it('detects binary attributes from their syntax, inherited or with ;binary', () => {
    expect(schema.isBinary('userCertificate')).toBe(true)
    expect(schema.isBinary('userCertificate;binary')).toBe(true)
    expect(schema.isBinary('jpegPhoto')).toBe(true)
    expect(schema.isBinary('cn')).toBe(false)
    expect(schema.isBinary('mail')).toBe(false)
  })

  it('round-trips the snapshot through the IPC schema', () => {
    expect(schemaSnapshotSchema.parse(schema.snapshot)).toEqual(schema.snapshot)
  })
})

describe('SchemaModel equality matching', () => {
  it('knows which attributes can be changed value by value', () => {
    expect(openldap.hasEqualityMatching('mail')).toBe(true)
    expect(openldap.hasEqualityMatching('cn')).toBe(true)
    expect(openldap.hasEqualityMatching('jpegPhoto')).toBe(false)
    expect(openldap.hasEqualityMatching('unknownAttribute')).toBe(true)
  })
})

describe('SchemaModel syntax inheritance', () => {
  it('takes the syntax from the superior type when an attribute declares none (OpenLDAP cn SUP name)', () => {
    expect(openldap.attributeType('cn')?.syntax).toBeUndefined()
    expect(openldap.attributeType('cn')?.sup).toBe('name')
    expect(openldap.syntaxOf('cn')).toBe('1.3.6.1.4.1.1466.115.121.1.15')
  })
})

describe('SchemaModel on the Active Directory sample', () => {
  it('detects objectGUID, objectSid and the security descriptor as binary', () => {
    expect(ad.isBinary('objectGUID')).toBe(true)
    expect(ad.isBinary('objectSid')).toBe(true)
    expect(ad.isBinary('nTSecurityDescriptor')).toBe(true)
    expect(ad.isBinary('sAMAccountName')).toBe(false)
  })

  it("knows AD's single-valued cn and its user class chain", () => {
    expect(ad.isSingleValued('cn')).toBe(true)
    expect(ad.superiorChain('user').map((objectClass) => objectClass.names[0])).toEqual([
      'user',
      'organizationalPerson',
      'person',
      'top',
    ])
    expect(ad.allowedAttributes(['user']).required).toEqual(
      expect.arrayContaining(['objectClass', 'instanceType', 'objectCategory']),
    )
  })
})

describe('SchemaModel without a schema', () => {
  const empty = new SchemaModel({ attributeTypes: [], objectClasses: [], syntaxes: [] })

  it('still knows the well-known binary attributes and the ;binary option', () => {
    expect(empty.isBinary('objectGUID')).toBe(true)
    expect(empty.isBinary('anything;binary')).toBe(true)
    expect(empty.isBinary('description')).toBe(false)
  })

  it('treats unknown attributes as multi-valued and modifiable', () => {
    expect(empty.isSingleValued('x')).toBe(false)
    expect(empty.isUserModifiable('x')).toBe(true)
    expect(empty.canonicalAttributeName('Foo;lang-en')).toBe('Foo')
    expect(empty.allowedAttributes(['person'])).toEqual({ required: [], optional: [] })
  })
})
