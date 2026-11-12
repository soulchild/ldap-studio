/**
 * Distinguished names per RFC 4514, parsed leniently: spaces around `,`, `+` and `=`
 * and `;` separators are accepted because users type and paste DNs that way.
 */

export interface Ava {
  /** Attribute type as written (descriptor or numeric OID). */
  type: string
  /** Decoded value. For a hex-encoded value (`#04...`) this is the `#...` text itself. */
  value: string
  /** True when the value was given in `#hexstring` form. */
  isHex: boolean
}

/** A relative DN: one or more attribute value assertions joined by `+`. */
export type Rdn = Ava[]

/** RDNs ordered from the entry itself to the root, as written in string form. */
export type Dn = Rdn[]

export type DnParseResult = { ok: true; dn: Dn } | { ok: false; error: string; offset: number }

const TYPE_DESCRIPTOR = /^[A-Za-z][A-Za-z0-9-]*$/
const TYPE_OID = /^\d+(\.\d+)*$/
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/
const SPECIAL_AFTER_BACKSLASH = new Set([' ', '"', '#', '+', ',', ';', '<', '=', '>', '\\'])

class DnSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message)
  }
}

export function parseDn(input: string): DnParseResult {
  try {
    return { ok: true, dn: new DnParser(input).parse() }
  } catch (error) {
    if (error instanceof DnSyntaxError) {
      return { ok: false, error: error.message, offset: error.offset }
    }
    throw error
  }
}

/** Parses a DN, throwing on invalid syntax. Use for DNs that come from the server. */
export function parseDnStrict(input: string): Dn {
  const result = parseDn(input)
  if (!result.ok) {
    throw new Error(`Invalid DN "${input}": ${result.error} at offset ${result.offset}`)
  }
  return result.dn
}

export function isValidDn(input: string): boolean {
  return parseDn(input).ok
}

/**
 * What a simple bind accepts as the name: a DN, or one of Active Directory's sign-in names,
 * `user@example.com` (user principal name) or `EXAMPLE\user` (down-level logon name).
 */
export function isValidBindName(input: string): boolean {
  const name = input.trim()
  if (/^[^\s@=,\\]+@[^\s@=,\\]+$/.test(name) || /^[^\s@=,\\]+\\[^\s@=,\\]+$/.test(name)) {
    return true
  }
  return isValidDn(name)
}

class DnParser {
  private pos = 0

  constructor(private readonly input: string) {}

  parse(): Dn {
    this.skipSpaces()
    if (this.pos >= this.input.length) {
      return []
    }
    const dn: Dn = [this.parseRdn()]
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]
      if (ch !== ',' && ch !== ';') {
        throw new DnSyntaxError(`Expected "," but found "${ch}"`, this.pos)
      }
      this.pos++
      this.skipSpaces()
      dn.push(this.parseRdn())
    }
    return dn
  }

  private parseRdn(): Rdn {
    const rdn: Rdn = [this.parseAva()]
    while (this.input[this.pos] === '+') {
      this.pos++
      this.skipSpaces()
      rdn.push(this.parseAva())
    }
    return rdn
  }

  private parseAva(): Ava {
    const typeStart = this.pos
    while (this.pos < this.input.length && /[A-Za-z0-9.-]/.test(this.input[this.pos] ?? '')) {
      this.pos++
    }
    const type = this.input.slice(typeStart, this.pos)
    if (type === '') {
      throw new DnSyntaxError('Expected an attribute type', typeStart)
    }
    if (!TYPE_DESCRIPTOR.test(type) && !TYPE_OID.test(type)) {
      throw new DnSyntaxError(`Invalid attribute type "${type}"`, typeStart)
    }
    this.skipSpaces()
    if (this.input[this.pos] !== '=') {
      throw new DnSyntaxError(`Expected "=" after "${type}"`, this.pos)
    }
    this.pos++
    this.skipSpaces()

    if (this.input[this.pos] === '#') {
      return { type, value: this.parseHexValue(), isHex: true }
    }
    if (this.input[this.pos] === '"') {
      return { type, value: this.parseQuotedValue(), isHex: false }
    }
    return { type, value: this.parseStringValue(), isHex: false }
  }

  private parseHexValue(): string {
    const start = this.pos
    this.pos++
    const digitsStart = this.pos
    while (this.pos < this.input.length && /[0-9A-Fa-f]/.test(this.input[this.pos] ?? '')) {
      this.pos++
    }
    const digits = this.input.slice(digitsStart, this.pos)
    if (digits.length === 0 || digits.length % 2 !== 0) {
      throw new DnSyntaxError('Hex value must have an even, non-zero number of digits', start)
    }
    this.skipSpaces()
    this.expectValueEnd()
    return `#${digits}`
  }

  /** Legacy RFC 2253 quoted value: everything up to the closing quote, with `\` escapes. */
  private parseQuotedValue(): string {
    const start = this.pos
    this.pos++
    const out = new ValueBuilder()
    while (this.pos < this.input.length && this.input[this.pos] !== '"') {
      if (this.input[this.pos] === '\\') {
        this.parseEscape(out)
      } else {
        out.pushChar(this.input[this.pos] ?? '', true)
        this.pos++
      }
    }
    if (this.input[this.pos] !== '"') {
      throw new DnSyntaxError('Unterminated quoted value', start)
    }
    this.pos++
    this.skipSpaces()
    this.expectValueEnd()
    return out.finish(start)
  }

  private parseStringValue(): string {
    const start = this.pos
    const out = new ValueBuilder()
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos] ?? ''
      if (ch === ',' || ch === ';' || ch === '+') {
        break
      }
      if (ch === '\\') {
        this.parseEscape(out)
        continue
      }
      if (ch === '"' || ch === '<' || ch === '>') {
        throw new DnSyntaxError(`Character "${ch}" must be escaped`, this.pos)
      }
      out.pushChar(ch, false)
      this.pos++
    }
    return out.finish(start)
  }

  private parseEscape(out: ValueBuilder): void {
    const escapeStart = this.pos
    this.pos++
    const next = this.input[this.pos]
    if (next === undefined) {
      throw new DnSyntaxError('Dangling "\\" at end of DN', escapeStart)
    }
    const pair = this.input.slice(this.pos, this.pos + 2)
    if (HEX_PAIR.test(pair)) {
      out.pushByte(parseInt(pair, 16))
      this.pos += 2
      return
    }
    if (SPECIAL_AFTER_BACKSLASH.has(next)) {
      out.pushChar(next, true)
      this.pos++
      return
    }
    throw new DnSyntaxError(`Invalid escape "\\${next}"`, escapeStart)
  }

  private expectValueEnd(): void {
    const ch = this.input[this.pos]
    if (ch !== undefined && ch !== ',' && ch !== ';' && ch !== '+') {
      throw new DnSyntaxError(`Unexpected "${ch}" after value`, this.pos)
    }
  }

  private skipSpaces(): void {
    while (this.input[this.pos] === ' ') {
      this.pos++
    }
  }
}

/**
 * Collects value characters, decoding runs of `\xx` escapes as UTF-8 and trimming
 * trailing spaces that were not escaped.
 */
class ValueBuilder {
  private chars: { ch: string; significant: boolean }[] = []
  private bytes: number[] = []

  pushChar(ch: string, escaped: boolean): void {
    this.flushBytes()
    this.chars.push({ ch, significant: escaped || ch !== ' ' })
  }

  pushByte(byte: number): void {
    this.bytes.push(byte)
  }

  finish(start: number): string {
    this.flushBytes(start)
    let end = this.chars.length
    while (end > 0 && !this.chars[end - 1]?.significant) {
      end--
    }
    return this.chars
      .slice(0, end)
      .map((c) => c.ch)
      .join('')
  }

  private flushBytes(offset = 0): void {
    if (this.bytes.length === 0) {
      return
    }
    let decoded: string
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(this.bytes))
    } catch {
      throw new DnSyntaxError('Escaped bytes are not valid UTF-8', offset)
    }
    this.bytes = []
    for (const ch of decoded) {
      this.chars.push({ ch, significant: true })
    }
  }
}

/** Escapes a value for use in a DN string per RFC 4514 section 2.4. */
export function escapeDnValue(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? ''
    if (ch === '\0') {
      out += '\\00'
    } else if ('"+,;<>\\'.includes(ch)) {
      out += `\\${ch}`
    } else if ((ch === ' ' || ch === '#') && i === 0) {
      out += `\\${ch}`
    } else if (ch === ' ' && i === value.length - 1) {
      out += '\\ '
    } else {
      out += ch
    }
  }
  return out
}

export function serializeAva(ava: Ava): string {
  return `${ava.type}=${ava.isHex ? ava.value : escapeDnValue(ava.value)}`
}

export function serializeRdn(rdn: Rdn): string {
  return rdn.map(serializeAva).join('+')
}

export function serializeDn(dn: Dn): string {
  return dn.map(serializeRdn).join(',')
}

/** Collapses runs of spaces and trims, as caseIgnoreMatch does (RFC 4518 insignificant space handling). */
function foldValue(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/ {2,}/g, ' ').trim()
}

function normalizeAva(ava: Ava): string {
  const type = ava.type.toLowerCase()
  const value = ava.isHex ? ava.value.toLowerCase() : escapeDnValue(foldValue(ava.value))
  return `${type}=${value}`
}

function normalizeRdn(rdn: Rdn): string {
  return rdn.map(normalizeAva).sort().join('+')
}

/**
 * Canonical form for comparing DNs and keying the tree: lower-cased types and values,
 * insignificant spaces removed, multi-valued RDNs sorted. Approximates caseIgnoreMatch,
 * so only use it for identity and lookup; send the server's own DN in operations.
 */
export function normalizeDn(input: string | Dn): string {
  const dn = typeof input === 'string' ? parseDnStrict(input) : input
  return dn.map(normalizeRdn).join(',')
}

export function dnEquals(a: string | Dn, b: string | Dn): boolean {
  return normalizeDn(a) === normalizeDn(b)
}

/** The parent of a DN, or `undefined` for the empty DN. A single-RDN DN has the empty DN as parent. */
export function parentDn(dn: Dn): Dn | undefined {
  return dn.length === 0 ? undefined : dn.slice(1)
}

/** True when `descendant` is strictly below `ancestor`. */
export function isDescendantOf(descendant: Dn, ancestor: Dn): boolean {
  if (descendant.length <= ancestor.length) {
    return false
  }
  const tail = descendant.slice(descendant.length - ancestor.length)
  return normalizeDn(tail) === normalizeDn(ancestor)
}

/** All ancestors of a DN from the root down to its parent, excluding the empty DN. */
export function ancestorsOf(dn: Dn): Dn[] {
  const result: Dn[] = []
  for (let i = dn.length - 1; i >= 1; i--) {
    result.push(dn.slice(i))
  }
  return result
}
