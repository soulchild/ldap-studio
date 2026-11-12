import { describe, expect, it } from 'vitest'
import { entryKind } from './entry-kind'

describe('entryKind', () => {
  it('decides by object class, ignoring case', () => {
    expect(entryKind(['top', 'inetOrgPerson'], 'uid=jdoe')).toBe('person')
    expect(entryKind(['top', 'groupOfNames'], 'cn=admins')).toBe('group')
    expect(entryKind(['top', 'organizationalUnit'], 'ou=people')).toBe('container')
    expect(entryKind(['top', 'dcObject', 'organization'], 'dc=example')).toBe('domain')
  })

  it('treats an Active Directory computer as a computer, not a user', () => {
    expect(entryKind(['top', 'person', 'organizationalPerson', 'user', 'computer'], 'cn=PC1')).toBe(
      'computer',
    )
  })

  it('falls back to the RDN attribute type when the classes are unknown', () => {
    expect(entryKind([], 'dc=example')).toBe('domain')
    expect(entryKind([], 'OU=Sales')).toBe('container')
    expect(entryKind([], 'cn=something')).toBe('other')
  })
})
