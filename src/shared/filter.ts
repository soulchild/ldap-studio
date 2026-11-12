/**
 * LDAP search filters per RFC 4515. Lenient where users expect it: whitespace between
 * components and a bare top-level item without parentheses (`uid=jdoe`) are accepted.
 */

/** Position of a node in the original input: `start` inclusive, `end` exclusive. */
export interface Span {
  start: number
  end: number
}

export interface AttributeRef extends Span {
  /** Attribute description as written, including options such as `;binary`. */
  name: string
}

export type FilterNode =
  | ({ type: 'and' | 'or'; filters: FilterNode[] } & Span)
  | ({ type: 'not'; filter: FilterNode } & Span)
  | ({ type: 'present'; attribute: AttributeRef } & Span)
  | ({
      type: 'equality' | 'approx' | 'greaterOrEqual' | 'lessOrEqual'
      attribute: AttributeRef
      value: string
    } & Span)
  | ({
      type: 'substrings'
      attribute: AttributeRef
      initial?: string
      any: string[]
      final?: string
    } & Span)
  | ({
      type: 'extensible'
      attribute?: AttributeRef
      dnAttributes: boolean
      matchingRule?: string
      value: string
    } & Span)

export type FilterParseResult =
  { ok: true; filter: FilterNode } | { ok: false; error: string; offset: number }

class FilterSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message)
  }
}

const ATTR_CHAR = /[A-Za-z0-9.;-]/
const ATTR_DESCRIPTION = /^([A-Za-z][A-Za-z0-9-]*|\d+(\.\d+)*)(;[A-Za-z0-9-]+)*$/
const MATCHING_RULE = /^([A-Za-z][A-Za-z0-9-]*|\d+(\.\d+)*)$/

export function parseFilter(input: string): FilterParseResult {
  try {
    return { ok: true, filter: new FilterParser(input).parse() }
  } catch (error) {
    if (error instanceof FilterSyntaxError) {
      return { ok: false, error: error.message, offset: error.offset }
    }
    throw error
  }
}

class FilterParser {
  private pos = 0

  constructor(private readonly input: string) {}

  parse(): FilterNode {
    this.skipSpaces()
    if (this.pos >= this.input.length) {
      throw new FilterSyntaxError('Filter is empty', 0)
    }
    let node: FilterNode
    if (this.input[this.pos] === '(') {
      node = this.parseFilter()
    } else {
      node = this.parseItem(this.input.length)
    }
    this.skipSpaces()
    if (this.pos < this.input.length) {
      throw new FilterSyntaxError(
        `Unexpected "${this.input[this.pos]}" after the end of the filter`,
        this.pos,
      )
    }
    return node
  }

  private parseFilter(): FilterNode {
    const start = this.pos
    if (this.input[this.pos] !== '(') {
      throw new FilterSyntaxError('Expected "("', this.pos)
    }
    this.pos++
    this.skipSpaces()
    const op = this.input[this.pos]
    let node: FilterNode
    if (op === '&' || op === '|') {
      this.pos++
      const filters = this.parseFilterList(start)
      node = { type: op === '&' ? 'and' : 'or', filters, start, end: 0 }
    } else if (op === '!') {
      this.pos++
      this.skipSpaces()
      if (this.input[this.pos] !== '(') {
        throw new FilterSyntaxError('Expected "(" after "!"', this.pos)
      }
      node = { type: 'not', filter: this.parseFilter(), start, end: 0 }
    } else {
      const close = this.findItemEnd(start)
      node = this.parseItem(close)
      node.start = start
    }
    this.skipSpaces()
    if (this.input[this.pos] !== ')') {
      throw new FilterSyntaxError(`Missing ")" to close "(" at ${start}`, this.pos)
    }
    this.pos++
    node.end = this.pos
    return node
  }

  private parseFilterList(openParen: number): FilterNode[] {
    const filters: FilterNode[] = []
    this.skipSpaces()
    while (this.input[this.pos] === '(') {
      filters.push(this.parseFilter())
      this.skipSpaces()
    }
    if (filters.length === 0) {
      throw new FilterSyntaxError('Expected at least one filter in the set', this.pos)
    }
    if (this.pos >= this.input.length) {
      throw new FilterSyntaxError(`Missing ")" to close "(" at ${openParen}`, this.pos)
    }
    return filters
  }

  /** The item runs up to the next unescaped ")" (or end of input for a bare item). */
  private findItemEnd(openParen: number): number {
    for (let i = this.pos; i < this.input.length; i++) {
      const ch = this.input[i]
      if (ch === ')') {
        return i
      }
      if (ch === '(') {
        throw new FilterSyntaxError('Character "(" in a value must be escaped as \\28', i)
      }
    }
    throw new FilterSyntaxError(`Missing ")" to close "(" at ${openParen}`, this.input.length)
  }

  private parseItem(end: number): FilterNode {
    const start = this.pos
    const text = this.input.slice(start, end)
    const paren = text.search(/[()]/)
    if (paren !== -1) {
      const ch = text[paren]
      throw new FilterSyntaxError(
        `Character "${ch}" in a value must be escaped as ${ch === '(' ? '\\28' : '\\29'}`,
        start + paren,
      )
    }
    const match = /^(.*?)(~=|>=|<=|:=|=)/.exec(text)
    if (!match) {
      throw new FilterSyntaxError('Expected an attribute followed by "=", "~=", ">=", "<=" or ":="', start)
    }
    const lhs = match[1] ?? ''
    const op = match[2] ?? '='
    const valueStart = start + lhs.length + op.length
    const rawValue = text.slice(lhs.length + op.length)
    this.pos = end

    if (op === ':=') {
      return this.parseExtensible(lhs, start, rawValue, valueStart, end)
    }

    const attribute = this.parseAttribute(lhs, start)
    if (op === '=') {
      if (rawValue === '*') {
        return { type: 'present', attribute, start, end }
      }
      if (this.hasUnescapedStar(rawValue)) {
        return this.parseSubstrings(attribute, rawValue, valueStart, start, end)
      }
    } else if (this.hasUnescapedStar(rawValue)) {
      throw new FilterSyntaxError(
        `"*" is only allowed with "="; escape it as \\2a`,
        valueStart + rawValue.indexOf('*'),
      )
    }
    const value = decodeValue(rawValue, valueStart)
    const type =
      op === '=' ? 'equality' : op === '~=' ? 'approx' : op === '>=' ? 'greaterOrEqual' : 'lessOrEqual'
    return { type, attribute, value, start, end }
  }

  private parseAttribute(text: string, offset: number): AttributeRef {
    if (text === '') {
      throw new FilterSyntaxError('Expected an attribute name', offset)
    }
    if (!ATTR_DESCRIPTION.test(text)) {
      const bad = [...text].findIndex((ch) => !ATTR_CHAR.test(ch))
      throw new FilterSyntaxError(`Invalid attribute name "${text}"`, offset + Math.max(bad, 0))
    }
    return { name: text, start: offset, end: offset + text.length }
  }

  private parseExtensible(
    lhs: string,
    start: number,
    rawValue: string,
    valueStart: number,
    end: number,
  ): FilterNode {
    const parts = lhs.split(':')
    const attrText = parts[0] ?? ''
    let dnAttributes = false
    let matchingRule: string | undefined
    let cursor = start + attrText.length + 1
    for (const part of parts.slice(1)) {
      if (part.toLowerCase() === 'dn' && !dnAttributes && matchingRule === undefined) {
        dnAttributes = true
      } else if (MATCHING_RULE.test(part) && matchingRule === undefined) {
        matchingRule = part
      } else {
        throw new FilterSyntaxError(`Invalid extensible match component "${part}"`, cursor)
      }
      cursor += part.length + 1
    }
    const attribute = attrText === '' ? undefined : this.parseAttribute(attrText, start)
    if (!attribute && !matchingRule) {
      throw new FilterSyntaxError('Extensible match needs an attribute or a matching rule', start)
    }
    const node: FilterNode = {
      type: 'extensible',
      dnAttributes,
      value: decodeValue(rawValue, valueStart),
      start,
      end,
    }
    if (attribute) {
      node.attribute = attribute
    }
    if (matchingRule) {
      node.matchingRule = matchingRule
    }
    return node
  }

  private parseSubstrings(
    attribute: AttributeRef,
    rawValue: string,
    valueStart: number,
    start: number,
    end: number,
  ): FilterNode {
    const pieces: { text: string; offset: number }[] = []
    let pieceStart = 0
    for (let i = 0; i < rawValue.length; i++) {
      if (rawValue[i] === '*') {
        pieces.push({ text: rawValue.slice(pieceStart, i), offset: valueStart + pieceStart })
        pieceStart = i + 1
      }
    }
    pieces.push({ text: rawValue.slice(pieceStart), offset: valueStart + pieceStart })
    const first = pieces[0]
    const last = pieces[pieces.length - 1]
    const middle = pieces.slice(1, -1)
    if (middle.some((piece) => piece.text === '')) {
      const empty = middle.find((piece) => piece.text === '')
      throw new FilterSyntaxError('Two "*" in a row; remove one', (empty?.offset ?? valueStart) - 1)
    }
    const node: FilterNode = {
      type: 'substrings',
      attribute,
      any: middle.map((piece) => decodeValue(piece.text, piece.offset)),
      start,
      end,
    }
    if (first && first.text !== '') {
      node.initial = decodeValue(first.text, first.offset)
    }
    if (last && last.text !== '') {
      node.final = decodeValue(last.text, last.offset)
    }
    return node
  }

  private hasUnescapedStar(value: string): boolean {
    return value.includes('*')
  }

  private skipSpaces(): void {
    while (this.input[this.pos] === ' ' || this.input[this.pos] === '\t' || this.input[this.pos] === '\n') {
      this.pos++
    }
  }
}

/** Decodes `\xx` escapes (as UTF-8) in an assertion value. */
function decodeValue(raw: string, offset: number): string {
  if (!raw.includes('\\')) {
    return raw
  }
  const bytes: number[] = []
  const encoder = new TextEncoder()
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] ?? ''
    if (ch === '\\') {
      const pair = raw.slice(i + 1, i + 3)
      if (!/^[0-9A-Fa-f]{2}$/.test(pair)) {
        throw new FilterSyntaxError('"\\" must be followed by two hex digits, e.g. \\2a for "*"', offset + i)
      }
      bytes.push(parseInt(pair, 16))
      i += 2
    } else {
      const code = raw.codePointAt(i) ?? 0
      const char = String.fromCodePoint(code)
      bytes.push(...encoder.encode(char))
      i += char.length - 1
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    throw new FilterSyntaxError('Escaped bytes are not valid UTF-8', offset)
  }
}

/** Escapes a value for use in a filter: `*`, `(`, `)`, `\` and NUL. */
export function escapeFilterValue(value: string): string {
  return value.replace(/[*()\\\0]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/** Every attribute the filter references, with its position, for unknown-attribute warnings. */
export function collectFilterAttributes(node: FilterNode): AttributeRef[] {
  switch (node.type) {
    case 'and':
    case 'or':
      return node.filters.flatMap(collectFilterAttributes)
    case 'not':
      return collectFilterAttributes(node.filter)
    case 'extensible':
      return node.attribute ? [node.attribute] : []
    default:
      return [node.attribute]
  }
}

/** The base attribute name without options: `userCertificate;binary` → `userCertificate`. */
export function baseAttributeName(description: string): string {
  return description.split(';')[0] ?? description
}

export type FilterCursorContext =
  | { kind: 'attribute'; prefix: string; start: number }
  | { kind: 'objectClassValue'; prefix: string; start: number; attribute: string }
  | { kind: 'value'; prefix: string; start: number; attribute: string }
  | { kind: 'none' }

const VALUE_CONTEXT = /^([A-Za-z0-9.;-]+)(?::dn)?(?::[A-Za-z0-9.-]+)?(~=|>=|<=|:=|=)(.*)$/i

/**
 * What the user is typing at `cursor`, for autocomplete. Works on incomplete input
 * by looking only at the text since the last "(".
 */
export function filterContextAt(input: string, cursor: number): FilterCursorContext {
  const before = input.slice(0, cursor)
  const open = before.lastIndexOf('(')
  if (open === -1) {
    return contextForSegment(before, 0)
  }
  return contextForSegment(before.slice(open + 1), open + 1)
}

function contextForSegment(segment: string, segmentStart: number): FilterCursorContext {
  if (segment.includes(')')) {
    return { kind: 'none' }
  }
  if (/^[A-Za-z0-9.;-]*$/.test(segment)) {
    return { kind: 'attribute', prefix: segment, start: segmentStart }
  }
  const match = VALUE_CONTEXT.exec(segment)
  if (!match) {
    return { kind: 'none' }
  }
  const attribute = match[1] ?? ''
  const value = match[3] ?? ''
  const lastStar = value.lastIndexOf('*')
  const prefix = value.slice(lastStar + 1)
  const start = segmentStart + segment.length - prefix.length
  if (baseAttributeName(attribute).toLowerCase() === 'objectclass') {
    return { kind: 'objectClassValue', prefix, start, attribute }
  }
  return { kind: 'value', prefix, start, attribute }
}
