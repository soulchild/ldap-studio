/** Entry values and the modify-request diff the editor sends on save (design §11). */

/** Raw bytes in their own (non-shared) buffer, which is what crosses IPC. */
export type Bytes = Uint8Array<ArrayBuffer>

/** A text value, or raw bytes for binary attributes. Bytes are never converted to text. */
export type AttributeValue = string | Bytes

export interface EntryAttribute {
  /** Attribute description as the server returned it or the user typed it. */
  name: string
  values: AttributeValue[]
}

export interface Modification {
  operation: 'add' | 'delete' | 'replace'
  attribute: string
  /** For `delete`, an empty list removes the whole attribute. */
  values: AttributeValue[]
}

export interface DiffOptions {
  /** From the schema; single-valued attributes are always replaced rather than add/delete. */
  isSingleValued?: (attribute: string) => boolean
  /**
   * From the schema: attributes the server cannot change value by value. Without an EQUALITY
   * matching rule (jpegPhoto, for example) servers refuse adding or deleting single values.
   */
  replaceOnly?: (attribute: string) => boolean
}

export function valuesEqual(a: AttributeValue, b: AttributeValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b
  }
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function without(values: AttributeValue[], remove: AttributeValue[]): AttributeValue[] {
  return values.filter((value) => !remove.some((other) => valuesEqual(value, other)))
}

/** Attribute names are case-insensitive, and so are their options. */
function attributeKey(name: string): string {
  return name.toLowerCase()
}

/**
 * Builds the modify change list that turns `original` into `working`.
 *
 * - new attribute → `add` with its values
 * - attribute removed or emptied → `delete` without values
 * - single-valued, or every original value replaced → `replace`
 * - otherwise per-value `delete` and `add`, so values not touched by the user
 *   (including ones added concurrently on the server) stay as they are
 *
 * Attributes with no change are left out, so untouched values, binary ones
 * included, are never sent back to the server.
 */
export function diffEntry(
  original: EntryAttribute[],
  working: EntryAttribute[],
  options: DiffOptions = {},
): Modification[] {
  const workingByKey = new Map(working.map((attribute) => [attributeKey(attribute.name), attribute]))
  const originalKeys = new Set(original.map((attribute) => attributeKey(attribute.name)))
  const changes: Modification[] = []

  for (const before of original) {
    const after = workingByKey.get(attributeKey(before.name))
    const afterValues = after?.values ?? []
    if (afterValues.length === 0) {
      if (before.values.length > 0) {
        changes.push({ operation: 'delete', attribute: before.name, values: [] })
      }
      continue
    }
    const removed = without(before.values, afterValues)
    const added = without(afterValues, before.values)
    if (removed.length === 0 && added.length === 0) {
      continue
    }
    const name = after?.name ?? before.name
    const replacesEverything = removed.length === before.values.length
    if (options.isSingleValued?.(name) || options.replaceOnly?.(name) || replacesEverything) {
      changes.push({ operation: 'replace', attribute: name, values: afterValues })
      continue
    }
    if (removed.length > 0) {
      changes.push({ operation: 'delete', attribute: name, values: removed })
    }
    if (added.length > 0) {
      changes.push({ operation: 'add', attribute: name, values: added })
    }
  }

  for (const after of working) {
    if (!originalKeys.has(attributeKey(after.name)) && after.values.length > 0) {
      changes.push({ operation: 'add', attribute: after.name, values: after.values })
    }
  }

  return changes
}
