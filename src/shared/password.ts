/**
 * Hashes `userPassword` values in the `{SCHEME}base64` forms directory servers store, with Web
 * Crypto so the same code runs in the renderer and in unit tests. Weak methods (MD5, SMD5, DES
 * and MD5 crypt) are left out; whether the server accepts a method is up to the user.
 */

export const PASSWORD_METHODS = [
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
] as const

export type PasswordMethod = (typeof PASSWORD_METHODS)[number]

export const DEFAULT_PASSWORD_METHOD: PasswordMethod = 'SSHA-512'

/** Salt lengths in bytes, as Apache Directory Studio writes them. */
const SSHA_SALT = 8
const PKCS5S2_SALT = 16
const PKCS5S2_ROUNDS = 10_000
const PKCS5S2_KEY_BITS = 256

/** The `{SCHEME}` prefix and Web Crypto digest of each SHA method. */
const SHA_METHODS: Partial<Record<PasswordMethod, { scheme: string; digest: string; salted: boolean }>> = {
  'SSHA-512': { scheme: 'SSHA512', digest: 'SHA-512', salted: true },
  'SSHA-384': { scheme: 'SSHA384', digest: 'SHA-384', salted: true },
  'SSHA-256': { scheme: 'SSHA256', digest: 'SHA-256', salted: true },
  SSHA: { scheme: 'SSHA', digest: 'SHA-1', salted: true },
  'SHA-512': { scheme: 'SHA512', digest: 'SHA-512', salted: false },
  'SHA-384': { scheme: 'SHA384', digest: 'SHA-384', salted: false },
  'SHA-256': { scheme: 'SHA256', digest: 'SHA-256', salted: false },
  SHA: { scheme: 'SHA', digest: 'SHA-1', salted: false },
}

/** A fresh random salt for the method, or undefined if it uses none. */
export function newSalt(method: PasswordMethod): Uint8Array<ArrayBuffer> | undefined {
  const length = method === 'PKCS5S2' ? PKCS5S2_SALT : SHA_METHODS[method]?.salted ? SSHA_SALT : 0
  return length > 0 ? crypto.getRandomValues(new Uint8Array(length)) : undefined
}

/** The value to store for `password`; salted methods need the salt from {@link newSalt}. */
export async function hashPassword(
  password: string,
  method: PasswordMethod,
  salt?: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (method === 'Plaintext') {
    return password
  }
  const bytes = new TextEncoder().encode(password)
  if (method === 'PKCS5S2') {
    if (!salt) {
      throw new Error('PKCS5S2 needs a salt.')
    }
    const key = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits'])
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-1', salt, iterations: PKCS5S2_ROUNDS },
      key,
      PKCS5S2_KEY_BITS,
    )
    return `{PKCS5S2}${toBase64(concat(salt, new Uint8Array(derived)))}`
  }
  const sha = SHA_METHODS[method]
  if (!sha) {
    throw new Error(`Unknown hash method ${method}.`)
  }
  if (sha.salted && !salt) {
    throw new Error(`${method} needs a salt.`)
  }
  const extra = sha.salted && salt ? salt : new Uint8Array()
  const digest = new Uint8Array(await crypto.subtle.digest(sha.digest, concat(bytes, extra)))
  return `{${sha.scheme}}${toBase64(concat(digest, extra))}`
}

/** Display names of stored schemes that differ from the scheme itself. */
const SCHEME_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SHA_METHODS).map(([method, sha]) => [sha.scheme, method]),
)

/** The hash method of a stored value, e.g. `SSHA-512`; `Plaintext` without a `{SCHEME}` prefix. */
export function describePassword(value: string | Uint8Array): string {
  const text = typeof value === 'string' ? value : new TextDecoder().decode(value)
  const scheme = /^\{([^}]+)\}/.exec(text)?.[1]?.toUpperCase()
  if (!scheme) {
    return 'Plaintext'
  }
  return SCHEME_NAMES[scheme] ?? scheme
}

/** Whether the attribute holds passwords, so it gets the password editor. */
export function isPasswordAttribute(name: string): boolean {
  return (name.split(';')[0] ?? name).toLowerCase() === 'userpassword'
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(first.length + second.length)
  result.set(first)
  result.set(second, first.length)
  return result
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
