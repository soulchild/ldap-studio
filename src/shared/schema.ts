/**
 * The server schema as the app uses it (schema-model spec, design §8). Main parses the
 * subschema entry into a `SchemaSnapshot`, sends it to the renderer once per connection,
 * and both sides wrap it in a `SchemaModel` for synchronous lookups.
 */
import { z } from 'zod'

export const attributeTypeSchema = z.object({
  oid: z.string(),
  names: z.array(z.string()),
  description: z.string().optional(),
  obsolete: z.boolean(),
  sup: z.string().optional(),
  equality: z.string().optional(),
  ordering: z.string().optional(),
  substr: z.string().optional(),
  /** Syntax OID without the `{length}` suffix. */
  syntax: z.string().optional(),
  singleValue: z.boolean(),
  collective: z.boolean(),
  noUserModification: z.boolean(),
  usage: z.enum(['userApplications', 'directoryOperation', 'distributedOperation', 'dSAOperation']),
})
export type AttributeTypeDefinition = z.infer<typeof attributeTypeSchema>

export const objectClassSchema = z.object({
  oid: z.string(),
  names: z.array(z.string()),
  description: z.string().optional(),
  obsolete: z.boolean(),
  sup: z.array(z.string()),
  kind: z.enum(['structural', 'auxiliary', 'abstract']),
  must: z.array(z.string()),
  may: z.array(z.string()),
})
export type ObjectClassDefinition = z.infer<typeof objectClassSchema>

export const syntaxSchema = z.object({ oid: z.string(), description: z.string().optional() })
export type SyntaxDefinition = z.infer<typeof syntaxSchema>

export const schemaSnapshotSchema = z.object({
  attributeTypes: z.array(attributeTypeSchema),
  objectClasses: z.array(objectClassSchema),
  syntaxes: z.array(syntaxSchema),
})
export type SchemaSnapshot = z.infer<typeof schemaSnapshotSchema>
