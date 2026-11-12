import { BerWriter } from 'ldapts'
import { describe, expect, it } from 'vitest'
import { deletionOrder, TreeDeleteControl } from './subtree'

describe('deletionOrder', () => {
  it('puts every entry before its parent', () => {
    const order = deletionOrder([
      'ou=a,dc=x',
      'cn=1,ou=a,dc=x',
      'ou=b,ou=a,dc=x',
      'cn=2,ou=b,ou=a,dc=x',
      'cn=Doe\\, John,ou=b,ou=a,dc=x',
    ])
    const position = (dn: string) => order.indexOf(dn)
    expect(position('cn=2,ou=b,ou=a,dc=x')).toBeLessThan(position('ou=b,ou=a,dc=x'))
    expect(position('cn=Doe\\, John,ou=b,ou=a,dc=x')).toBeLessThan(position('ou=b,ou=a,dc=x'))
    expect(position('ou=b,ou=a,dc=x')).toBeLessThan(position('ou=a,dc=x'))
    expect(position('cn=1,ou=a,dc=x')).toBeLessThan(position('ou=a,dc=x'))
    expect(order.at(-1)).toBe('ou=a,dc=x')
  })
})

describe('TreeDeleteControl', () => {
  it('encodes as a critical control without a value', () => {
    const writer = new BerWriter()
    new TreeDeleteControl().write(writer)
    const oid = Buffer.from('1.2.840.113556.1.4.805')
    expect(writer.buffer).toEqual(
      Buffer.concat([
        Buffer.from([0x30, oid.length + 5, 0x04, oid.length]),
        oid,
        Buffer.from([0x01, 0x01, 0xff]),
      ]),
    )
  })
})
