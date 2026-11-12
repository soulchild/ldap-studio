import { describe, expect, it } from 'vitest'
import {
  ancestorsOf,
  isValidBindName,
  dnEquals,
  escapeDnValue,
  isDescendantOf,
  normalizeDn,
  parentDn,
  parseDn,
  parseDnStrict,
  serializeDn,
} from './dn'

function parseOk(input: string) {
  const result = parseDn(input)
  if (!result.ok) {
    throw new Error(`expected "${input}" to parse, got ${result.error} at ${result.offset}`)
  }
  return result.dn
}

function parseErr(input: string) {
  const result = parseDn(input)
  if (result.ok) {
    throw new Error(`expected "${input}" to fail`)
  }
  return result
}

describe('parseDn', () => {
  it('parses a simple DN into RDNs from leaf to root', () => {
    expect(parseOk('cn=jdoe,ou=people,dc=example,dc=com')).toEqual([
      [{ type: 'cn', value: 'jdoe', isHex: false }],
      [{ type: 'ou', value: 'people', isHex: false }],
      [{ type: 'dc', value: 'example', isHex: false }],
      [{ type: 'dc', value: 'com', isHex: false }],
    ])
  })

  it('treats the empty string as the empty (root DSE) DN', () => {
    expect(parseOk('')).toEqual([])
    expect(parseOk('   ')).toEqual([])
  })

  it('accepts spaces around separators and "=" as users type them', () => {
    const dn = parseOk('cn = jdoe , ou=People ;  dc=example')
    expect(dn.map((rdn) => rdn[0]?.value)).toEqual(['jdoe', 'People', 'example'])
  })

  it('parses multi-valued RDNs', () => {
    const dn = parseOk('cn=John+uid=jdoe,dc=example')
    expect(dn[0]).toEqual([
      { type: 'cn', value: 'John', isHex: false },
      { type: 'uid', value: 'jdoe', isHex: false },
    ])
  })

  it('decodes backslash-escaped special characters', () => {
    const dn = parseOk('cn=Doe\\, John\\+Jr\\;\\<x\\>\\"q\\"\\\\,dc=example')
    expect(dn[0]?.[0]?.value).toBe('Doe, John+Jr;<x>"q"\\')
  })

  it('decodes hex escapes as UTF-8, including multi-byte sequences', () => {
    expect(parseOk('cn=J\\C3\\BCrgen,dc=example')[0]?.[0]?.value).toBe('Jürgen')
    expect(parseOk('cn=caf\\c3\\a9')[0]?.[0]?.value).toBe('café')
  })

  it('keeps escaped leading and trailing spaces but trims unescaped trailing ones', () => {
    expect(parseOk('cn=\\ lead,dc=x')[0]?.[0]?.value).toBe(' lead')
    expect(parseOk('cn=trail\\ ,dc=x')[0]?.[0]?.value).toBe('trail ')
    expect(parseOk('cn=trail   ,dc=x')[0]?.[0]?.value).toBe('trail')
    expect(parseOk('cn=two  words,dc=x')[0]?.[0]?.value).toBe('two  words')
  })

  it('keeps #hexstring values in hex form', () => {
    expect(parseOk('1.3.6.1.4.1.1466.0=#04024869,dc=x')[0]).toEqual([
      { type: '1.3.6.1.4.1.1466.0', value: '#04024869', isHex: true },
    ])
  })

  it('accepts legacy quoted values', () => {
    expect(parseOk('cn="Doe, John",dc=x')[0]?.[0]?.value).toBe('Doe, John')
  })

  it('accepts unescaped "=" inside a value', () => {
    expect(parseOk('cn=a=b,dc=x')[0]?.[0]?.value).toBe('a=b')
  })

  it.each([
    ['cn=jdoe,', 'Expected an attribute type', 8],
    ['cn', 'Expected "="', 2],
    ['=jdoe', 'Expected an attribute type', 0],
    ['1cn=x', 'Invalid attribute type', 0],
    ['cn=a<b', 'must be escaped', 4],
    ['cn=a\\', 'Dangling', 4],
    ['cn=a\\zz', 'Invalid escape', 4],
    ['cn=#abc', 'even, non-zero', 3],
    ['cn="open', 'Unterminated', 3],
    ['cn=\\ff\\fe', 'not valid UTF-8', 3],
  ])('rejects %j with an error at the right offset', (input, message, offset) => {
    const error = parseErr(input)
    expect(error.error).toContain(message)
    expect(error.offset).toBe(offset)
  })
})

describe('escapeDnValue and serializeDn', () => {
  it('escapes special characters, leading space or "#", and trailing space', () => {
    expect(escapeDnValue('Doe, John')).toBe('Doe\\, John')
    expect(escapeDnValue('a+b;c<d>e"f\\g')).toBe('a\\+b\\;c\\<d\\>e\\"f\\\\g')
    expect(escapeDnValue(' lead')).toBe('\\ lead')
    expect(escapeDnValue('#hash')).toBe('\\#hash')
    expect(escapeDnValue('trail ')).toBe('trail\\ ')
    expect(escapeDnValue('mid#dle')).toBe('mid#dle')
    expect(escapeDnValue('nul\0')).toBe('nul\\00')
  })

  it('round-trips through parse and serialize', () => {
    for (const input of [
      'cn=Doe\\, John,ou=people,dc=example,dc=com',
      'cn=John+uid=jdoe,dc=example',
      'cn=\\ lead\\ ,dc=x',
      'cn=\\#x,dc=x',
      '1.2.3=#0401ff,dc=x',
      'cn=Jürgen,dc=x',
    ]) {
      expect(serializeDn(parseDnStrict(input))).toBe(input)
    }
  })

  it('serializes leniently typed input in canonical spacing', () => {
    expect(serializeDn(parseDnStrict('cn = jdoe , ou=People'))).toBe('cn=jdoe,ou=People')
  })
})

describe('normalizeDn and dnEquals', () => {
  it('ignores case of types and values', () => {
    expect(dnEquals('CN=JDoe,OU=People,DC=Example', 'cn=jdoe,ou=people,dc=example')).toBe(true)
  })

  it('ignores insignificant whitespace', () => {
    expect(dnEquals('cn=jdoe, ou=People, dc=example, dc=com', 'cn=jdoe,ou=people,dc=example,dc=com')).toBe(
      true,
    )
    expect(dnEquals('cn=two   words', 'cn=two words')).toBe(true)
  })

  it('ignores the order of AVAs in a multi-valued RDN', () => {
    expect(dnEquals('uid=jdoe+cn=John,dc=x', 'cn=John+uid=jdoe,dc=x')).toBe(true)
  })

  it('treats escaped and hex-escaped forms of the same value as equal', () => {
    expect(dnEquals('cn=Doe\\2C John', 'cn=Doe\\, John')).toBe(true)
  })

  it('distinguishes different values', () => {
    expect(dnEquals('cn=jdoe,dc=x', 'cn=jdoe2,dc=x')).toBe(false)
    expect(dnEquals('cn=jdoe,dc=x', 'uid=jdoe,dc=x')).toBe(false)
  })

  it('produces a parseable canonical string', () => {
    const normalized = normalizeDn('CN=Doe\\, John , DC=Example')
    expect(normalized).toBe('cn=doe\\, john,dc=example')
    expect(parseDn(normalized).ok).toBe(true)
  })
})

describe('hierarchy helpers', () => {
  const dn = parseDnStrict('cn=jdoe,ou=people,dc=example,dc=com')

  it('returns the parent and the empty DN above a single RDN', () => {
    expect(serializeDn(parentDn(dn) ?? [])).toBe('ou=people,dc=example,dc=com')
    expect(parentDn(parseDnStrict('dc=com'))).toEqual([])
    expect(parentDn([])).toBeUndefined()
  })

  it('detects descendants case-insensitively', () => {
    expect(isDescendantOf(dn, parseDnStrict('OU=People,DC=example,DC=com'))).toBe(true)
    expect(isDescendantOf(dn, dn)).toBe(false)
    expect(isDescendantOf(dn, parseDnStrict('ou=groups,dc=example,dc=com'))).toBe(false)
  })

  it('lists ancestors from the root down to the parent', () => {
    expect(ancestorsOf(dn).map(serializeDn)).toEqual([
      'dc=com',
      'dc=example,dc=com',
      'ou=people,dc=example,dc=com',
    ])
  })
})

describe('isValidBindName', () => {
  it('accepts DNs and Active Directory sign-in names', () => {
    expect(isValidBindName('cn=admin,dc=example,dc=com')).toBe(true)
    expect(isValidBindName('jdoe@example.com')).toBe(true)
    expect(isValidBindName('EXAMPLE\\jdoe')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isValidBindName('not a dn')).toBe(false)
    expect(isValidBindName('jdoe@')).toBe(false)
    expect(isValidBindName('a@b@c')).toBe(false)
    expect(isValidBindName('EXAMPLE\\')).toBe(false)
  })
})
