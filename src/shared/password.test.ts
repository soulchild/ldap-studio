import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSWORD_METHOD,
  describePassword,
  hashPassword,
  isPasswordAttribute,
  newSalt,
  PASSWORD_METHODS,
} from './password'

const encoder = new TextEncoder()
const salt = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])

// Reference values from Python's hashlib: base64(digest(password + salt) + salt), and for
// PKCS5S2 base64(salt + pbkdf2_hmac('sha1', password, salt, 10000, 32)).
describe('hashPassword', () => {
  it('hashes unsalted SHA values to their published digests', async () => {
    expect(await hashPassword('password', 'SHA')).toBe('{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=')
    expect(await hashPassword('password', 'SHA-256')).toBe(
      '{SHA256}XohImNooBHFR0OVvjcYpJ3NgPQ1qq73WKhHvch0VQtg=',
    )
  })

  it('hashes every SHA variant like Node does', async () => {
    expect(await hashPassword('pässword', 'SHA-384')).toBe(
      '{SHA384}2/UOrrph58rmvmfMef4cEuPix7/+GprRvS88pxO41FikCtbioEeUGz1piAYerKcI',
    )
    expect(await hashPassword('pässword', 'SHA-512')).toBe(
      '{SHA512}KF3icbSeAO9oGc8Ku/AxXpfCXLo2FhZ8dw78Umxki03hH0sA3HH67TOjEse6g2kNPtFKqq32tiKqSJlv8H7IpA==',
    )
  })

  it('appends the salt to the password and to the digest for salted SHA', async () => {
    expect(await hashPassword('secret', 'SSHA', salt)).toBe('{SSHA}lHFzXul4wnzRItssVcTnvXWRjNgBAgMEBQYHCA==')
    expect(await hashPassword('secret', 'SSHA-256', salt)).toBe(
      '{SSHA256}A7N1lAy5bBb4T6qH9e85zAvHBmzNPhRFbZ105DjjWDIBAgMEBQYHCA==',
    )
    expect(await hashPassword('secret', 'SSHA-384', salt)).toBe(
      '{SSHA384}H9r23Uh6bS245RzeTpSaM5qygtY55tmguB+tMJSp+hl+9bmccuj6N64Rpv50W9DfAQIDBAUGBwg=',
    )
    expect(await hashPassword('secret', 'SSHA-512', salt)).toBe(
      '{SSHA512}KO8EsMPQTwZrxxbOkDAOOXEeVCc2grMQg1pnZwZhC1bBQLby8zCmFn7qTZRvoTd+yQdROQQNYHWpTUST4zjTdQECAwQFBgcI',
    )
  })

  it('derives PKCS5S2 with PBKDF2-SHA1, 10,000 rounds, salt first and a 32-byte key', async () => {
    const pkcsSalt = Uint8Array.from({ length: 16 }, (_, index) => index)
    expect(await hashPassword('secret', 'PKCS5S2', pkcsSalt)).toBe(
      '{PKCS5S2}AAECAwQFBgcICQoLDA0OD8O7V+ZxDKCL9nOaS+G4edWKL3+dAn80P9ezRVfqT6er',
    )
  })

  it('stores plaintext as it is', async () => {
    expect(await hashPassword('secret', 'Plaintext')).toBe('secret')
  })

  it('needs a salt for salted methods', async () => {
    await expect(hashPassword('secret', 'SSHA-512')).rejects.toThrow(/salt/)
  })
})

describe('newSalt', () => {
  it('makes 8 random bytes for SSHA, 16 for PKCS5S2 and none for unsalted methods', () => {
    expect(newSalt('SSHA-512')).toHaveLength(8)
    expect(newSalt('PKCS5S2')).toHaveLength(16)
    expect(newSalt('SHA-256')).toBeUndefined()
    expect(newSalt('Plaintext')).toBeUndefined()
    expect(newSalt('SSHA')).not.toEqual(newSalt('SSHA'))
  })
})

describe('describePassword', () => {
  it('names the hash method of a stored value, as text or bytes', () => {
    expect(describePassword('{SSHA512}abc')).toBe('SSHA-512')
    expect(describePassword(encoder.encode('{ssha}abc'))).toBe('SSHA')
    expect(describePassword('{SHA256}abc')).toBe('SHA-256')
    expect(describePassword('{PKCS5S2}abc')).toBe('PKCS5S2')
    expect(describePassword('{CRYPT}$6$abc')).toBe('CRYPT')
    expect(describePassword('{ARGON2}$argon2id$abc')).toBe('ARGON2')
  })

  it('calls a value without a scheme plaintext', () => {
    expect(describePassword('secret')).toBe('Plaintext')
    expect(describePassword('')).toBe('Plaintext')
  })
})

describe('isPasswordAttribute', () => {
  it('matches userPassword by name, any case, with options', () => {
    expect(isPasswordAttribute('userPassword')).toBe(true)
    expect(isPasswordAttribute('USERPASSWORD')).toBe(true)
    expect(isPasswordAttribute('userPassword;binary')).toBe(true)
    expect(isPasswordAttribute('mail')).toBe(false)
  })
})

it('offers only the strong-enough methods, defaulting to SSHA-512', () => {
  expect(PASSWORD_METHODS).toEqual([
    'SSHA-512',
    'SSHA-384',
    'SSHA-256',
    'SSHA',
    'SHA-512',
    'SHA-384',
    'SHA-256',
    'SHA',
    'PKCS5S2',
    'Plaintext',
  ])
  expect(DEFAULT_PASSWORD_METHOD).toBe('SSHA-512')
})
