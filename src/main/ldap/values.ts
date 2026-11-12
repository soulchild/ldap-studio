/**
 * Converts ldapts search entries into the shared entry shape. Every value is requested as raw
 * bytes (design §5) and decoded here, so binary data never passes through a text conversion.
 */
import type { AttributeValue, Bytes, EntryAttribute } from '@shared/entry'

/**
 * Passed as ldapts' `explicitBufferAttributes`: ldapts checks `includes(name)` for each
 * attribute, so this makes it return every value as a Buffer regardless of name spelling.
 */
export class EveryAttribute extends Array<string> {
  override includes(): boolean {
    return true
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Copies the bytes into a standalone array. A Buffer is often a view into Node's shared
 * allocation pool; sending the view over IPC would copy the whole pool, other data included.
 */
function ownBytes(buffer: Uint8Array): Bytes {
  return new Uint8Array(buffer)
}

export function decodeValue(value: Buffer | string, binary: boolean): AttributeValue {
  if (typeof value === 'string') {
    return value
  }
  if (binary) {
    return ownBytes(value)
  }
  try {
    return utf8.decode(value)
  } catch {
    return ownBytes(value)
  }
}

/** True for attributes requested or returned with the `;binary` option. */
export function hasBinaryOption(name: string): boolean {
  return name
    .split(';')
    .slice(1)
    .some((option) => option.toLowerCase() === 'binary')
}

export type IsBinary = (attributeName: string) => boolean

export interface RawEntry {
  dn: string
  [attribute: string]: Buffer | Buffer[] | string | string[]
}

export function decodeEntry(raw: RawEntry, isBinary: IsBinary): { dn: string; attributes: EntryAttribute[] } {
  const attributes: EntryAttribute[] = []
  for (const [name, value] of Object.entries(raw)) {
    if (name === 'dn') {
      continue
    }
    const binary = hasBinaryOption(name) || isBinary(name)
    attributes.push({ name, values: [value].flat().map((item) => decodeValue(item, binary)) })
  }
  return { dn: raw.dn, attributes }
}
