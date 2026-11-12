/**
 * Editing an entry's attributes (entry-editing spec). Pure: the working copy is a list of
 * attributes; empty text values count as removed. Changes are computed with `diffEntry`.
 */
import {
  diffEntry,
  valuesEqual,
  type AttributeValue,
  type EntryAttribute,
  type Modification,
} from '@shared/entry'
import type { SchemaModel } from '@shared/schema-model'

export type Working = EntryAttribute[]

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const find = (working: Working, name: string) => working.findIndex((attribute) => same(attribute.name, name))

function withValues(
  working: Working,
  name: string,
  update: (values: AttributeValue[]) => AttributeValue[],
): Working {
  const index = find(working, name)
  if (index === -1) {
    return working
  }
  return working.map((attribute, position) =>
    position === index ? { ...attribute, values: update(attribute.values) } : attribute,
  )
}

export function setValue(working: Working, name: string, index: number, value: AttributeValue): Working {
  return withValues(working, name, (values) =>
    values.map((current, position) => (position === index ? value : current)),
  )
}

export function addValue(working: Working, name: string, value: AttributeValue = ''): Working {
  return withValues(working, name, (values) => [...values, value])
}

/** Removes one value; an attribute left without values is removed too. */
export function removeValue(working: Working, name: string, index: number): Working {
  const next = withValues(working, name, (values) => values.filter((_, position) => position !== index))
  return next.filter((attribute) => !same(attribute.name, name) || attribute.values.length > 0)
}

/** Adds an attribute with one empty value to fill in; an existing attribute gets another value instead. */
export function addAttribute(working: Working, name: string): Working {
  return find(working, name) === -1 ? [...working, { name, values: [''] }] : addValue(working, name)
}

export function removeAttribute(working: Working, name: string): Working {
  return working.filter((attribute) => !same(attribute.name, name))
}

/** The working copy as it would be saved: empty text values and empty attributes dropped. */
export function cleaned(working: Working): Working {
  return working
    .map((attribute) => ({
      ...attribute,
      values: attribute.values.filter((value) => typeof value !== 'string' || value.trim() !== ''),
    }))
    .filter((attribute) => attribute.values.length > 0)
}

export function changes(original: Working, working: Working, schema: SchemaModel): Modification[] {
  return diffEntry(cleaned(original), cleaned(working), {
    isSingleValued: (name) => schema.isSingleValued(name),
    replaceOnly: (name) => !schema.hasEqualityMatching(name),
  })
}

export function objectClassesOf(working: Working): string[] {
  const attribute = working[find(working, 'objectClass')]
  return (attribute?.values ?? []).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )
}

export function requiredAttributes(working: Working, schema: SchemaModel): string[] {
  return schema.allowedAttributes(objectClassesOf(working)).required
}

/**
 * Operational attributes servers commonly return, for when the schema is not readable. With a
 * schema, its USAGE decides.
 */
const KNOWN_OPERATIONAL = new Set(
  [
    'createTimestamp',
    'modifyTimestamp',
    'creatorsName',
    'modifiersName',
    'entryUUID',
    'entryCSN',
    'entryDN',
    'structuralObjectClass',
    'subschemaSubentry',
    'hasSubordinates',
    'numSubordinates',
    'contextCSN',
    'pwdChangedTime',
    'nsUniqueId',
    'nsAccountLock',
    'uSNChanged',
    'uSNCreated',
    'whenChanged',
    'whenCreated',
  ].map((name) => name.toLowerCase()),
)

export function isOperationalAttribute(name: string, schema: SchemaModel): boolean {
  return schema.isOperational(name) || KNOWN_OPERATIONAL.has((name.split(';')[0] ?? name).toLowerCase())
}

export type AttributeGroup = 'objectClass' | 'required' | 'optional' | 'operational'

const GROUP_ORDER: Record<AttributeGroup, number> = {
  objectClass: 0,
  required: 1,
  optional: 2,
  operational: 3,
}
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/**
 * The display order (entry-editing spec): objectClass first, then the attributes the object
 * classes require, then the rest, then operational attributes; alphabetical within each group.
 * Independent of the order the server returned, so rows never jump around.
 */
export function orderAttributes(
  working: Working,
  schema: SchemaModel,
): { attribute: EntryAttribute; group: AttributeGroup }[] {
  const required = new Set(requiredAttributes(working, schema).map((name) => name.toLowerCase()))
  const groupOf = (name: string): AttributeGroup => {
    const base = (name.split(';')[0] ?? name).toLowerCase()
    if (base === 'objectclass') {
      return 'objectClass'
    }
    if (isOperationalAttribute(name, schema)) {
      return 'operational'
    }
    return required.has(schema.canonicalAttributeName(name).toLowerCase()) ? 'required' : 'optional'
  }
  return working
    .map((attribute) => ({ attribute, group: groupOf(attribute.name) }))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || byName.compare(a.attribute.name, b.attribute.name),
    )
}

/** Problems that block saving, by attribute name (schema checks before saving). */
export function validate(working: Working, schema: SchemaModel): Map<string, string> {
  const problems = new Map<string, string>()
  const saved = cleaned(working)
  for (const name of requiredAttributes(working, schema)) {
    if (find(saved, name) === -1) {
      problems.set(name, `${name} is required by the entry's object classes.`)
    }
  }
  for (const attribute of saved) {
    if (attribute.values.length > 1 && schema.isSingleValued(attribute.name)) {
      problems.set(attribute.name, `${attribute.name} can only have one value.`)
    }
  }
  return problems
}

/** Whether an attribute differs from the original, for the pending-change marker. */
export function isChanged(original: Working, working: Working, name: string): boolean {
  const before = cleaned(original)[find(cleaned(original), name)]?.values ?? []
  const after = cleaned(working)[find(cleaned(working), name)]?.values ?? []
  return (
    before.length !== after.length ||
    before.some((value) => !after.some((other) => valuesEqual(value, other))) ||
    after.some((value) => !before.some((other) => valuesEqual(value, other)))
  )
}

/** Whether a value is new or edited compared to the original attribute. */
export function isNewValue(original: Working, name: string, value: AttributeValue): boolean {
  const before = original[find(original, name)]?.values ?? []
  return !before.some((other) => valuesEqual(value, other))
}

/** Attributes that can still be added: allowed by the object classes and not present yet. */
export function addableAttributes(working: Working, schema: SchemaModel): string[] {
  const { required, optional } = schema.allowedAttributes(objectClassesOf(working))
  return [...required, ...optional]
    .filter((name) => find(cleaned(working), name) === -1 && schema.isUserModifiable(name))
    .sort((a, b) => a.localeCompare(b))
}

/** How many attributes a list of modifications touches: what the user thinks of as their changes. */
export function changedAttributeCount(modifications: Modification[]): number {
  return new Set(modifications.map((modification) => modification.attribute.toLowerCase())).size
}
