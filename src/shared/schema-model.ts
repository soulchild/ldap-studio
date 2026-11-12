/**
 * Lookups over a `SchemaSnapshot` (schema-model spec). Pure, so main and the renderer share it:
 * case-insensitive lookup by any name or OID, inherited MUST/MAY, and attribute properties.
 */
import type { AttributeTypeDefinition, ObjectClassDefinition, SchemaSnapshot } from './schema'

/** Syntaxes whose values are bytes rather than text (design §8). */
export const BINARY_SYNTAXES = new Set([
  '1.3.6.1.4.1.1466.115.121.1.4', // Audio
  '1.3.6.1.4.1.1466.115.121.1.5', // Binary
  '1.3.6.1.4.1.1466.115.121.1.8', // Certificate
  '1.3.6.1.4.1.1466.115.121.1.9', // Certificate List
  '1.3.6.1.4.1.1466.115.121.1.10', // Certificate Pair
  '1.3.6.1.4.1.1466.115.121.1.23', // Fax
  '1.3.6.1.4.1.1466.115.121.1.28', // JPEG
  '1.3.6.1.4.1.1466.115.121.1.40', // Octet String
  '1.3.6.1.4.1.1466.115.121.1.49', // Supported Algorithm
  '1.2.840.113556.1.4.907', // Active Directory NT security descriptor
])

/** Active Directory attributes that are binary even where the schema is unavailable. */
export const KNOWN_BINARY_ATTRIBUTES = new Set([
  'objectguid',
  'objectsid',
  'sidhistory',
  'tokengroups',
  'msexchmailboxguid',
  'msds-consistencyguid',
  'thumbnailphoto',
  'ntsecuritydescriptor',
  'unicodepwd',
])

export interface AllowedAttributes {
  /** Canonical names of attributes the object classes require. */
  required: string[]
  /** Canonical names of the remaining allowed attributes. */
  optional: string[]
}

function key(name: string): string {
  return (name.split(';')[0] ?? name).toLowerCase()
}

/** True for `name;binary` and other descriptions carrying the binary option. */
export function hasBinaryOption(description: string): boolean {
  return description
    .split(';')
    .slice(1)
    .some((option) => option.toLowerCase() === 'binary')
}

export class SchemaModel {
  private readonly attributes = new Map<string, AttributeTypeDefinition>()
  private readonly classes = new Map<string, ObjectClassDefinition>()

  constructor(readonly snapshot: SchemaSnapshot) {
    for (const type of snapshot.attributeTypes) {
      for (const name of [type.oid, ...type.names]) {
        this.attributes.set(name.toLowerCase(), type)
      }
    }
    for (const objectClass of snapshot.objectClasses) {
      for (const name of [objectClass.oid, ...objectClass.names]) {
        this.classes.set(name.toLowerCase(), objectClass)
      }
    }
  }

  /** By any name or OID, ignoring case and attribute options (`userCertificate;binary`). */
  attributeType(name: string): AttributeTypeDefinition | undefined {
    return this.attributes.get(key(name))
  }

  objectClass(name: string): ObjectClassDefinition | undefined {
    return this.classes.get(name.toLowerCase())
  }

  /** The first declared name, so `CommonName` and `2.5.4.3` both become `cn`. Unknown names pass through. */
  canonicalAttributeName(name: string): string {
    return this.attributeType(name)?.names[0] ?? name.split(';')[0] ?? name
  }

  canonicalObjectClassName(name: string): string {
    return this.objectClass(name)?.names[0] ?? name
  }

  attributeNames(): string[] {
    return this.snapshot.attributeTypes.flatMap((type) => type.names)
  }

  objectClassNames(): string[] {
    return this.snapshot.objectClasses.flatMap((objectClass) => objectClass.names)
  }

  /** Follows SUP for properties an attribute type inherits when it does not declare them. */
  private inherited<K extends 'syntax' | 'equality'>(name: string, property: K): AttributeTypeDefinition[K] {
    const seen = new Set<AttributeTypeDefinition>()
    let type = this.attributeType(name)
    while (type && !seen.has(type)) {
      if (type[property] !== undefined) {
        return type[property]
      }
      seen.add(type)
      type = type.sup ? this.attributeType(type.sup) : undefined
    }
    return undefined
  }

  syntaxOf(name: string): string | undefined {
    return this.inherited(name, 'syntax')
  }

  isBinary(name: string): boolean {
    if (hasBinaryOption(name) || KNOWN_BINARY_ATTRIBUTES.has(key(name))) {
      return true
    }
    const syntax = this.syntaxOf(name)
    return syntax !== undefined && BINARY_SYNTAXES.has(syntax)
  }

  /**
   * Whether the server can compare values of this attribute, which adding or deleting single
   * values requires. Unknown attributes are assumed comparable.
   */
  hasEqualityMatching(name: string): boolean {
    return this.attributeType(name) === undefined || this.inherited(name, 'equality') !== undefined
  }

  isSingleValued(name: string): boolean {
    return this.attributeType(name)?.singleValue ?? false
  }

  /** Unknown attributes are assumed modifiable; the server has the final say. */
  isUserModifiable(name: string): boolean {
    return !(this.attributeType(name)?.noUserModification ?? false)
  }

  isOperational(name: string): boolean {
    const usage = this.attributeType(name)?.usage
    return usage !== undefined && usage !== 'userApplications'
  }

  /** The class and all its superiors, each once, the class itself first. */
  superiorChain(name: string): ObjectClassDefinition[] {
    const chain: ObjectClassDefinition[] = []
    const pending = [name]
    while (pending.length > 0) {
      const objectClass = this.objectClass(pending.shift() ?? '')
      if (!objectClass || chain.includes(objectClass)) {
        continue
      }
      chain.push(objectClass)
      pending.push(...objectClass.sup)
    }
    return chain
  }

  /** Required and optional attributes for an entry with these object classes, including inherited ones. */
  allowedAttributes(objectClasses: string[]): AllowedAttributes {
    const required = new Map<string, string>()
    const optional = new Map<string, string>()
    for (const objectClass of objectClasses.flatMap((name) => this.superiorChain(name))) {
      for (const name of objectClass.must) {
        required.set(key(this.canonicalAttributeName(name)), this.canonicalAttributeName(name))
      }
      for (const name of objectClass.may) {
        optional.set(key(this.canonicalAttributeName(name)), this.canonicalAttributeName(name))
      }
    }
    for (const name of required.keys()) {
      optional.delete(name)
    }
    return { required: [...required.values()], optional: [...optional.values()] }
  }
}
