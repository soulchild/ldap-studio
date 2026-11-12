import { describe, expect, it } from 'vitest'
import { SchemaModel } from '@shared/schema-model'
import { buildFilter, filterRows } from './quick-filter'

describe('buildFilter', () => {
  it('builds one item per operator, escaping the value', () => {
    const f = (operator: Parameters<typeof buildFilter>[0]['operator'], value = 'a*b') =>
      buildFilter({ attribute: 'cn', operator, value })
    expect(f('equals')).toBe('(cn=a\\2ab)')
    expect(f('contains')).toBe('(cn=*a\\2ab*)')
    expect(f('startsWith')).toBe('(cn=a\\2ab*)')
    expect(f('endsWith')).toBe('(cn=*a\\2ab)')
    expect(f('exists', '')).toBe('(cn=*)')
    expect(f('greaterOrEqual', '5')).toBe('(cn>=5)')
    expect(f('lessOrEqual', '5')).toBe('(cn<=5)')
    expect(f('approx', 'jon')).toBe('(cn~=jon)')
  })

  it('searches the naming attributes when no attribute is given', () => {
    expect(buildFilter({ attribute: '', operator: 'contains', value: 'doe' })).toBe(
      '(|(cn=*doe*)(uid=*doe*)(ou=*doe*)(o=*doe*)(dc=*doe*))',
    )
    expect(buildFilter({ attribute: ' ', operator: 'exists', value: '' })).toBe('(objectClass=*)')
  })

  it('uses only the naming attributes the schema knows', () => {
    const type = (name: string) => ({
      oid: `1.${name}`,
      names: [name],
      obsolete: false,
      singleValue: false,
      collective: false,
      noUserModification: false,
      usage: 'userApplications' as const,
    })
    const ad = new SchemaModel({
      attributeTypes: [type('cn'), type('ou'), type('sAMAccountName')],
      objectClasses: [],
      syntaxes: [],
    })
    expect(buildFilter({ attribute: '', operator: 'equals', value: 'x' }, ad)).toBe(
      '(|(cn=x)(ou=x)(sAMAccountName=x))',
    )
  })

  it('is undefined while the input is incomplete or the attribute is not a name', () => {
    expect(buildFilter({ attribute: 'cn', operator: 'contains', value: ' ' })).toBeUndefined()
    expect(buildFilter({ attribute: 'c n', operator: 'equals', value: 'x' })).toBeUndefined()
    expect(buildFilter({ attribute: '(cn', operator: 'equals', value: 'x' })).toBeUndefined()
  })
})

describe('filterRows', () => {
  const root = 'dc=example,dc=com'
  const rows = (matches: string[]) =>
    filterRows(
      matches.map((dn) => ({ dn, objectClasses: ['top'] })),
      [root],
    ).map((row) => `${'  '.repeat(row.depth)}${row.match ? '*' : ''}${row.label}`)

  it('shows each match below the entries leading to it, from the tree root, sorted', () => {
    expect(
      rows([`uid=jdoe,ou=people,${root}`, `cn=admins,ou=groups,${root}`, `uid=asmith,ou=people,${root}`]),
    ).toEqual([
      'dc=example,dc=com',
      '  ou=groups',
      '    *cn=admins',
      '  ou=people',
      '    *uid=asmith',
      '    *uid=jdoe',
    ])
  })

  it('marks an entry that matches and also leads to other matches', () => {
    expect(rows([`ou=people,${root}`, `uid=jdoe,ou=people,${root}`])).toEqual([
      'dc=example,dc=com',
      '  *ou=people',
      '    *uid=jdoe',
    ])
  })

  it('lists a match outside every root on its own', () => {
    expect(rows(['cn=config'])).toEqual(['*cn=config'])
  })
})
