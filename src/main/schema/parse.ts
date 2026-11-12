/**
 * Parses subschema definitions (RFC 4512 section 4.1). Tolerant where real servers differ:
 * quoted OIDs (Active Directory), irregular spacing, and unknown extension keywords.
 * A definition that cannot be parsed is skipped and reported as a warning.
 */
import type {
  AttributeTypeDefinition,
  ObjectClassDefinition,
  SchemaSnapshot,
  SyntaxDefinition,
} from '@shared/schema'

type Token = { kind: 'open' | 'close' | 'dollar' } | { kind: 'word' | 'quoted'; value: string }

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (/\s/.test(ch)) {
      i++
    } else if (ch === '(') {
      tokens.push({ kind: 'open' })
      i++
    } else if (ch === ')') {
      tokens.push({ kind: 'close' })
      i++
    } else if (ch === '$') {
      tokens.push({ kind: 'dollar' })
      i++
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1)
      if (end === -1) {
        throw new Error(`Unterminated quoted string at ${i}`)
      }
      tokens.push({ kind: 'quoted', value: unescapeQdstring(text.slice(i + 1, end)) })
      i = end + 1
    } else {
      let end = i
      while (end < text.length && !/[\s()$']/.test(text[end] ?? '')) {
        end++
      }
      tokens.push({ kind: 'word', value: text.slice(i, end) })
      i = end
    }
  }
  return tokens
}

/** RFC 4512 qdstring escapes: `\27` for a quote and `\5C` for a backslash. */
function unescapeQdstring(value: string): string {
  return value.replace(/\\27/gi, "'").replace(/\\5c/gi, '\\')
}

const FLAGS = new Set([
  'OBSOLETE',
  'SINGLE-VALUE',
  'COLLECTIVE',
  'NO-USER-MODIFICATION',
  'ABSTRACT',
  'STRUCTURAL',
  'AUXILIARY',
])

/** A definition as keyword → values; flags map to an empty list. */
interface RawDefinition {
  oid: string
  fields: Map<string, string[]>
}

export function parseDefinition(text: string): RawDefinition {
  const tokens = tokenize(text)
  let position = 0
  const next = () => tokens[position++]
  const peek = () => tokens[position]

  if (next()?.kind !== 'open') {
    throw new Error('Definition must start with "("')
  }
  const oidToken = next()
  if (!oidToken || (oidToken.kind !== 'word' && oidToken.kind !== 'quoted')) {
    throw new Error('Definition must start with an OID')
  }
  const fields = new Map<string, string[]>()

  for (;;) {
    const token = next()
    if (!token) {
      throw new Error('Missing closing ")"')
    }
    if (token.kind === 'close') {
      break
    }
    if (token.kind !== 'word') {
      throw new Error(`Expected a keyword, found ${token.kind}`)
    }
    const keyword = token.value.toUpperCase()
    const following = peek()
    const takesValue =
      VALUE_KEYWORDS.has(keyword) ||
      keyword.startsWith('X-') ||
      (!FLAGS.has(keyword) && (following?.kind === 'open' || following?.kind === 'quoted'))
    if (!takesValue) {
      fields.set(keyword, [])
      continue
    }
    fields.set(keyword, readValue())
  }
  return { oid: oidToken.value, fields }

  function readValue(): string[] {
    const token = next()
    if (!token) {
      throw new Error('Missing value')
    }
    if (token.kind === 'word' || token.kind === 'quoted') {
      return [token.value]
    }
    if (token.kind !== 'open') {
      throw new Error('Expected a value')
    }
    const values: string[] = []
    for (;;) {
      const item = next()
      if (!item) {
        throw new Error('Missing ")" after a value list')
      }
      if (item.kind === 'close') {
        return values
      }
      if (item.kind === 'word' || item.kind === 'quoted') {
        values.push(item.value)
      }
    }
  }
}

/** Keywords that always take a value, even if the value looks like a keyword. */
const VALUE_KEYWORDS = new Set([
  'NAME',
  'DESC',
  'SUP',
  'EQUALITY',
  'ORDERING',
  'SUBSTR',
  'SYNTAX',
  'USAGE',
  'MUST',
  'MAY',
])

function first(fields: Map<string, string[]>, key: string): string | undefined {
  return fields.get(key)?.[0]
}

function optional<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: string }
}

export function parseAttributeType(text: string): AttributeTypeDefinition {
  const { oid, fields } = parseDefinition(text)
  const syntax = first(fields, 'SYNTAX')?.replace(/\{\d+\}$/, '')
  const usage = first(fields, 'USAGE') ?? 'userApplications'
  if (!['userApplications', 'directoryOperation', 'distributedOperation', 'dSAOperation'].includes(usage)) {
    throw new Error(`Unknown USAGE ${usage}`)
  }
  return {
    oid,
    names: fields.get('NAME') ?? [],
    ...optional('description', first(fields, 'DESC')),
    obsolete: fields.has('OBSOLETE'),
    ...optional('sup', first(fields, 'SUP')),
    ...optional('equality', first(fields, 'EQUALITY')),
    ...optional('ordering', first(fields, 'ORDERING')),
    ...optional('substr', first(fields, 'SUBSTR')),
    ...optional('syntax', syntax),
    singleValue: fields.has('SINGLE-VALUE'),
    collective: fields.has('COLLECTIVE'),
    noUserModification: fields.has('NO-USER-MODIFICATION'),
    usage: usage as AttributeTypeDefinition['usage'],
  }
}

export function parseObjectClass(text: string): ObjectClassDefinition {
  const { oid, fields } = parseDefinition(text)
  return {
    oid,
    names: fields.get('NAME') ?? [],
    ...optional('description', first(fields, 'DESC')),
    obsolete: fields.has('OBSOLETE'),
    sup: fields.get('SUP') ?? [],
    kind: fields.has('ABSTRACT') ? 'abstract' : fields.has('AUXILIARY') ? 'auxiliary' : 'structural',
    must: fields.get('MUST') ?? [],
    may: fields.get('MAY') ?? [],
  }
}

export function parseSyntax(text: string): SyntaxDefinition {
  const { oid, fields } = parseDefinition(text)
  return { oid, ...optional('description', first(fields, 'DESC')) }
}

export interface RawSubschema {
  objectClasses: string[]
  attributeTypes: string[]
  ldapSyntaxes: string[]
}

export interface ParsedSchema {
  snapshot: SchemaSnapshot
  /** Definitions that could not be parsed and were skipped. */
  warnings: string[]
}

export function parseSubschema(raw: RawSubschema): ParsedSchema {
  const warnings: string[] = []
  function all<T>(texts: string[], parse: (text: string) => T, label: string): T[] {
    const parsed: T[] = []
    for (const text of texts) {
      try {
        parsed.push(parse(text))
      } catch (error) {
        warnings.push(`Skipped ${label} ${text.slice(0, 80)}: ${(error as Error).message}`)
      }
    }
    return parsed
  }
  return {
    snapshot: {
      attributeTypes: all(raw.attributeTypes, parseAttributeType, 'attribute type'),
      objectClasses: all(raw.objectClasses, parseObjectClass, 'object class'),
      syntaxes: all(raw.ldapSyntaxes, parseSyntax, 'syntax'),
    },
    warnings,
  }
}
