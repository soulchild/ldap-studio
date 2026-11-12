/**
 * Help while typing a search (directory-search spec: filter validation and autocomplete).
 * Pure: the CodeMirror fields only turn these results into marks and suggestion lists.
 */
import { baseAttributeName, collectFilterAttributes, filterContextAt, parseFilter } from '@shared/filter'
import type { SchemaModel } from '@shared/schema-model'

export interface Suggestions {
  /** Where the replaced text starts. */
  from: number
  options: string[]
}

export interface Diagnostic {
  from: number
  to: number
  severity: 'error' | 'warning'
  message: string
}

const MAX_OPTIONS = 50

function matching(names: string[], prefix: string): string[] {
  const lower = prefix.toLowerCase()
  const seen = new Set<string>()
  return names
    .filter((name) => name.toLowerCase().startsWith(lower))
    .filter((name) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_OPTIONS)
}

/** Attribute names where an attribute is typed, object classes in an objectClass value. */
export function filterSuggestions(
  input: string,
  cursor: number,
  schema: SchemaModel,
): Suggestions | undefined {
  const context = filterContextAt(input, cursor)
  if (context.kind === 'attribute') {
    return { from: context.start, options: matching(schema.attributeNames(), context.prefix) }
  }
  if (context.kind === 'objectClassValue') {
    return { from: context.start, options: matching(schema.objectClassNames(), context.prefix) }
  }
  return undefined
}

/** Attribute names for the comma-separated list of attributes to return. */
export function attributeListSuggestions(input: string, cursor: number, schema: SchemaModel): Suggestions {
  const before = input.slice(0, cursor)
  const start = Math.max(before.lastIndexOf(','), before.lastIndexOf(' ')) + 1
  return { from: start, options: matching([...schema.attributeNames(), '*', '+'], before.slice(start)) }
}

export function parseAttributeList(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean)
}

/** A syntax error stops the search; unknown attributes only warn (the server may still know them). */
export function filterDiagnostics(
  input: string,
  schema: SchemaModel,
  schemaAvailable: boolean,
): Diagnostic[] {
  if (input.trim() === '') {
    return []
  }
  const result = parseFilter(input)
  if (!result.ok) {
    const from = Math.min(result.offset, Math.max(input.length - 1, 0))
    return [{ from, to: Math.min(from + 1, input.length), severity: 'error', message: result.error }]
  }
  if (!schemaAvailable) {
    return []
  }
  return collectFilterAttributes(result.filter)
    .filter((attribute) => schema.attributeType(baseAttributeName(attribute.name)) === undefined)
    .map((attribute) => ({
      from: attribute.start,
      to: attribute.end,
      severity: 'warning' as const,
      message: `${attribute.name} is not in the server's schema.`,
    }))
}
