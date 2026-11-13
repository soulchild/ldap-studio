/**
 * The tree filter (directory-tree spec: filter the tree): an attribute, an operator and a value
 * become an LDAP filter, and the server's matches become tree rows with the entries leading to
 * them.
 */
import { escapeFilterValue } from '@shared/filter'
import { ancestorsOf, parseDn, serializeDn, serializeRdn } from '@shared/dn'
import type { SearchEntry } from '@shared/ipc'
import type { SchemaModel } from '@shared/schema-model'
import { keyOf } from './model'

export type FilterOperator =
  'equals' | 'contains' | 'startsWith' | 'endsWith' | 'exists' | 'greaterOrEqual' | 'lessOrEqual' | 'approx'

export const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'exists', label: 'exists' },
  { value: 'greaterOrEqual', label: '≥' },
  { value: 'lessOrEqual', label: '≤' },
  { value: 'approx', label: 'sounds like' },
]

/** Searched when no attribute is given: the usual naming attributes. */
const NAME_ATTRIBUTES = ['cn', 'uid', 'ou', 'o', 'dc', 'sAMAccountName']

export interface QuickFilter {
  /** Empty means "the name": the usual naming attributes. */
  attribute: string
  operator: FilterOperator
  value: string
}

export function needsValue(operator: FilterOperator): boolean {
  return operator !== 'exists'
}

/** The LDAP filter, or undefined while the input is incomplete. */
export function buildFilter(input: QuickFilter, schema?: SchemaModel): string | undefined {
  const attribute = input.attribute.trim()
  const value = input.value.trim()
  if (needsValue(input.operator) && value === '') {
    return undefined
  }
  if (attribute !== '' && !/^[A-Za-z0-9][\w.;-]*$/.test(attribute)) {
    return undefined
  }
  const v = escapeFilterValue(value)
  const item = (name: string): string => {
    switch (input.operator) {
      case 'equals':
        return `(${name}=${v})`
      case 'contains':
        return `(${name}=*${v}*)`
      case 'startsWith':
        return `(${name}=${v}*)`
      case 'endsWith':
        return `(${name}=*${v})`
      case 'exists':
        return `(${name}=*)`
      case 'greaterOrEqual':
        return `(${name}>=${v})`
      case 'lessOrEqual':
        return `(${name}<=${v})`
      case 'approx':
        return `(${name}~=${v})`
    }
  }
  if (attribute !== '') {
    return item(attribute)
  }
  if (input.operator === 'exists') {
    return '(objectClass=*)'
  }
  // With a schema, only the naming attributes this server knows (sAMAccountName is AD's).
  const names =
    schema && schema.snapshot.attributeTypes.length > 0
      ? NAME_ATTRIBUTES.filter((name) => schema.attributeType(name) !== undefined)
      : NAME_ATTRIBUTES.filter((name) => name !== 'sAMAccountName')
  return names.length === 1 ? item(names[0] ?? 'cn') : `(|${names.map(item).join('')})`
}

export interface FilterMatch {
  dn: string
  objectClasses: string[]
}

/** A search result, read with `attributes: ['objectClass']`, as a match. */
export function toFilterMatch(entry: SearchEntry): FilterMatch {
  return {
    dn: entry.dn,
    objectClasses: (
      entry.attributes.find((attribute) => attribute.name.toLowerCase() === 'objectclass')?.values ?? []
    ).filter((value): value is string => typeof value === 'string'),
  }
}

export interface FilterRow {
  key: string
  dn: string
  /** The root's full DN, otherwise the entry's own RDN. */
  label: string
  depth: number
  objectClasses: string[]
  /** False for entries only shown because they lead to a match. */
  match: boolean
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The matches as a tree: each with the entries from its tree root down to it, children sorted
 * by name. Matches outside every root are listed as roots of their own.
 */
export function filterRows(matches: readonly FilterMatch[], rootDns: readonly string[]): FilterRow[] {
  interface Item extends FilterRow {
    children: Map<string, Item>
  }
  const roots = new Map<string, Item>()
  const rootKeys = new Set(rootDns.map(keyOf))
  const all = new Map<string, Item>()
  const item = (dn: string, label: string, depth: number): Item => ({
    key: keyOf(dn),
    dn,
    label,
    depth,
    objectClasses: [],
    match: false,
    children: new Map(),
  })

  for (const match of matches) {
    const parsed = parseDn(match.dn)
    if (!parsed.ok) {
      continue
    }
    const path = [...ancestorsOf(parsed.dn), parsed.dn]
    const rootIndex = path.findIndex((level) => rootKeys.has(keyOf(serializeDn(level))))
    const levels = rootIndex >= 0 ? path.slice(rootIndex) : [parsed.dn]
    let parent: Map<string, Item> = roots
    levels.forEach((level, index) => {
      const dn = index === levels.length - 1 ? match.dn : serializeDn(level)
      const key = keyOf(dn)
      let node = all.get(key)
      if (!node) {
        node = item(dn, index === 0 ? dn : serializeRdn(level[0] ?? []), index)
        all.set(key, node)
        parent.set(key, node)
      }
      if (index === levels.length - 1) {
        node.match = true
        node.objectClasses = match.objectClasses
      }
      parent = node.children
    })
  }

  const rows: FilterRow[] = []
  const visit = (items: Map<string, Item>) => {
    for (const node of [...items.values()].sort((a, b) => collator.compare(a.label, b.label))) {
      const { children, ...row } = node
      rows.push(row)
      visit(children)
    }
  }
  visit(roots)
  return rows
}
