import { describe, expect, it } from 'vitest'
import {
  baseAttributeName,
  collectFilterAttributes,
  escapeFilterValue,
  filterContextAt,
  parseFilter,
  type FilterNode,
} from './filter'

function parseOk(input: string): FilterNode {
  const result = parseFilter(input)
  if (!result.ok) {
    throw new Error(`expected "${input}" to parse, got ${result.error} at ${result.offset}`)
  }
  return result.filter
}

function parseErr(input: string) {
  const result = parseFilter(input)
  if (result.ok) {
    throw new Error(`expected "${input}" to fail`)
  }
  return result
}

describe('parseFilter: simple items', () => {
  it('parses equality with spans', () => {
    expect(parseOk('(uid=jdoe)')).toEqual({
      type: 'equality',
      attribute: { name: 'uid', start: 1, end: 4 },
      value: 'jdoe',
      start: 0,
      end: 10,
    })
  })

  it('parses presence, approx, >= and <=', () => {
    expect(parseOk('(mail=*)').type).toBe('present')
    expect(parseOk('(cn~=jon)').type).toBe('approx')
    expect(parseOk('(uidNumber>=1000)')).toMatchObject({ type: 'greaterOrEqual', value: '1000' })
    expect(parseOk('(uidNumber<=1999)')).toMatchObject({ type: 'lessOrEqual', value: '1999' })
  })

  it('parses substrings into initial, any and final parts', () => {
    expect(parseOk('(cn=jo*n*doe)')).toMatchObject({
      type: 'substrings',
      initial: 'jo',
      any: ['n'],
      final: 'doe',
    })
    expect(parseOk('(cn=*doe)')).toMatchObject({ type: 'substrings', any: [], final: 'doe' })
    expect(parseOk('(cn=jo*)')).toMatchObject({ type: 'substrings', initial: 'jo', any: [] })
    expect(parseOk('(cn=*a*b*)')).toMatchObject({ type: 'substrings', any: ['a', 'b'] })
  })

  it('accepts attribute options and numeric OIDs', () => {
    expect(parseOk('(userCertificate;binary=*)')).toMatchObject({
      attribute: { name: 'userCertificate;binary' },
    })
    expect(parseOk('(2.5.4.3=jdoe)')).toMatchObject({ attribute: { name: '2.5.4.3' } })
  })

  it('accepts a bare item without parentheses', () => {
    expect(parseOk('uid=jdoe')).toMatchObject({ type: 'equality', value: 'jdoe', start: 0, end: 8 })
  })

  it('keeps spaces inside values', () => {
    expect(parseOk('(cn=John Doe )')).toMatchObject({ value: 'John Doe ' })
  })
})

describe('parseFilter: escapes', () => {
  it('decodes hex escapes, including UTF-8 sequences', () => {
    expect(parseOk('(cn=a\\2ab\\28c\\29\\5c)')).toMatchObject({ type: 'equality', value: 'a*b(c)\\' })
    expect(parseOk('(cn=J\\c3\\bcrgen)')).toMatchObject({ value: 'Jürgen' })
    expect(parseOk('(cn=Jürgen)')).toMatchObject({ value: 'Jürgen' })
  })

  it('round-trips values through escapeFilterValue', () => {
    const raw = 'a*b(c)\\d\0'
    expect(parseOk(`(cn=${escapeFilterValue(raw)})`)).toMatchObject({ value: raw })
  })
})

describe('parseFilter: sets', () => {
  it('parses nested and/or/not', () => {
    const input = '(&(objectClass=person)(|(uid=a)(uid=b))(!(mail=*)))'
    const filter = parseOk(input)
    expect(filter.type).toBe('and')
    if (filter.type !== 'and') {
      return
    }
    expect(filter.filters.map((f) => f.type)).toEqual(['equality', 'or', 'not'])
    expect(filter.end).toBe(input.length)
  })

  it('accepts whitespace between components', () => {
    expect(parseOk(' (& (uid=a)\n  (uid=b) ) ').type).toBe('and')
  })
})

describe('parseFilter: extensible match', () => {
  it('parses attribute, dn flag and matching rule', () => {
    expect(parseOk('(cn:dn:2.4.6.8.10:=Dino)')).toMatchObject({
      type: 'extensible',
      attribute: { name: 'cn' },
      dnAttributes: true,
      matchingRule: '2.4.6.8.10',
      value: 'Dino',
    })
    expect(parseOk('(sn:caseExactMatch:=Doe)')).toMatchObject({
      matchingRule: 'caseExactMatch',
      dnAttributes: false,
    })
    expect(parseOk('(:1.2.3:=x)')).toMatchObject({ type: 'extensible', matchingRule: '1.2.3' })
    expect(parseOk('(userAccountControl:1.2.840.113556.1.4.803:=2)')).toMatchObject({
      attribute: { name: 'userAccountControl' },
    })
  })

  it('requires an attribute or a matching rule', () => {
    expect(parseErr('(:dn:=x)').error).toContain('needs an attribute or a matching rule')
  })
})

describe('parseFilter: errors with offsets', () => {
  it('reports the missing closing parenthesis at the end of input', () => {
    const input = '(&(uid=jdoe)(mail=*)'
    const error = parseErr(input)
    expect(error.error).toContain('Missing ")"')
    expect(error.offset).toBe(input.length)
  })

  it.each([
    ['', 'empty', 0],
    ['(uid=jdoe', 'Missing ")"', 9],
    ['(uid=jdoe))', 'Unexpected ")"', 10],
    ['(uidjdoe)', 'Expected an attribute', 1],
    ['(=jdoe)', 'Expected an attribute name', 1],
    ['(u id=x)', 'Invalid attribute name', 2],
    ['(cn=a(b)', 'must be escaped as \\28', 5],
    ['uid=a)', 'must be escaped as \\29', 5],
    ['(cn=a\\zz)', 'two hex digits', 5],
    ['(cn=a**b)', 'Two "*" in a row', 5],
    ['(cn>=a*)', 'only allowed with "="', 6],
    ['(&)', 'at least one filter', 2],
    ['(!uid=a)', 'Expected "(" after "!"', 2],
    ['(cn=\\ff)', 'not valid UTF-8', 4],
  ])('rejects %j', (input, message, offset) => {
    const error = parseErr(input)
    expect(error.error).toContain(message)
    expect(error.offset).toBe(offset)
  })
})

describe('collectFilterAttributes', () => {
  it('lists every referenced attribute with its span', () => {
    const filter = parseOk('(&(objectClass=person)(|(mail=*)(cn:dn:=x))(!(sn=a*)))')
    expect(collectFilterAttributes(filter).map((a) => a.name)).toEqual(['objectClass', 'mail', 'cn', 'sn'])
  })

  it('strips options for schema lookup', () => {
    expect(baseAttributeName('userCertificate;binary')).toBe('userCertificate')
    expect(baseAttributeName('cn')).toBe('cn')
  })
})

describe('filterContextAt', () => {
  const at = (input: string) => filterContextAt(input, input.length)

  it('detects an attribute being typed', () => {
    expect(at('(ma')).toEqual({ kind: 'attribute', prefix: 'ma', start: 1 })
    expect(at('(&(uid=a)(')).toEqual({ kind: 'attribute', prefix: '', start: 10 })
    expect(at('ma')).toEqual({ kind: 'attribute', prefix: 'ma', start: 0 })
  })

  it('detects an objectClass value being typed', () => {
    expect(at('(objectClass=inet')).toEqual({
      kind: 'objectClassValue',
      prefix: 'inet',
      start: 13,
      attribute: 'objectClass',
    })
    expect(at('(&(OBJECTCLASS=pos')).toMatchObject({ kind: 'objectClassValue', prefix: 'pos' })
  })

  it('detects other values, using the text after the last "*" as prefix', () => {
    expect(at('(cn=jo*do')).toEqual({ kind: 'value', prefix: 'do', start: 7, attribute: 'cn' })
    expect(at('(uidNumber>=10')).toMatchObject({ kind: 'value', attribute: 'uidNumber', prefix: '10' })
  })

  it('returns none after a closed item or an operator', () => {
    expect(at('(uid=a)')).toEqual({ kind: 'none' })
    expect(at('(&')).toEqual({ kind: 'none' })
  })

  it('uses the cursor position, not the end of input', () => {
    const input = '(&(ma)(uid=x))'
    expect(filterContextAt(input, 5)).toEqual({ kind: 'attribute', prefix: 'ma', start: 3 })
  })
})
