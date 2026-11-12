/**
 * The contract between renderer and main (design §4). Every request and response
 * crosses the process boundary through these schemas: main validates each incoming
 * payload, and the preload API is typed from them.
 */
import { z } from 'zod'
import { schemaSnapshotSchema } from './schema'
import { settingsSchema } from './settings'

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

/** Text, or raw bytes for binary attributes. Bytes cross IPC as Uint8Array (structured clone). */
export const attributeValueSchema = z.union([z.string(), z.instanceof(Uint8Array)])

export const entryAttributeSchema = z.object({
  name: z.string().min(1),
  values: z.array(attributeValueSchema),
})

export const connectionIdSchema = z.string().min(1)
export const dnSchema = z.string()

export const securityModeSchema = z.enum(['none', 'ldaps', 'starttls'])
export type SecurityMode = z.infer<typeof securityModeSchema>

export const DEFAULT_PORTS: Record<SecurityMode, number> = { none: 389, starttls: 389, ldaps: 636 }

/** A connection profile as the renderer sees it: never the password, only whether one is saved. */
export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  security: securityModeSchema,
  bindDn: z.string(),
  baseDn: z.string(),
  /** PEM-encoded CA certificates trusted in addition to the system roots. */
  caCertificates: z.array(z.string()),
  /** SHA-256 fingerprint (hex, colon-separated) of a server certificate the user chose to trust. */
  trustedFingerprint: z.string().optional(),
  hasSavedPassword: z.boolean(),
})
export type Profile = z.infer<typeof profileSchema>

export const profileInputSchema = profileSchema.omit({ id: true, hasSavedPassword: true }).extend({
  id: z.string().min(1).optional(),
  /** `keep` leaves a saved password as it is; `set` saves a new one; `clear` removes it. */
  password: z.discriminatedUnion('action', [
    z.object({ action: z.literal('keep') }),
    z.object({ action: z.literal('clear') }),
    z.object({ action: z.literal('set'), value: z.string() }),
  ]),
})
export type ProfileInput = z.infer<typeof profileInputSchema>

export const certificateInfoSchema = z.object({
  subject: z.string(),
  issuer: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  serialNumber: z.string(),
  fingerprint256: z.string(),
})
export type CertificateInfo = z.infer<typeof certificateInfoSchema>

/** Errors are values, not exceptions, so the renderer can show a specific message for each kind. */
export const appErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('network'), message: z.string() }),
  z.object({ kind: z.literal('tls'), message: z.string() }),
  z.object({
    kind: z.literal('certificateUntrusted'),
    message: z.string(),
    reason: z.string(),
    certificate: certificateInfoSchema,
    /** True when a trusted fingerprint exists but the server presented a different certificate. */
    fingerprintMismatch: z.boolean(),
  }),
  z.object({ kind: z.literal('startTlsRefused'), message: z.string() }),
  z.object({
    kind: z.literal('ldap'),
    message: z.string(),
    resultCode: z.number().int(),
    resultName: z.string(),
    diagnostic: z.string().optional(),
  }),
  z.object({ kind: z.literal('notConnected'), message: z.string() }),
  z.object({ kind: z.literal('storage'), message: z.string() }),
  z.object({ kind: z.literal('invalidRequest'), message: z.string() }),
  z.object({ kind: z.literal('cancelled'), message: z.string() }),
])
export type AppError = z.infer<typeof appErrorSchema>

export function resultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: appErrorSchema }),
  ])
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export const rootDseSchema = z.object({
  namingContexts: z.array(z.string()),
  supportedControls: z.array(z.string()),
  supportedExtensions: z.array(z.string()),
  subschemaSubentry: z.string().optional(),
  vendorName: z.string().optional(),
  isActiveDirectory: z.boolean(),
})
export type RootDse = z.infer<typeof rootDseSchema>

export const searchScopeSchema = z.enum(['base', 'one', 'sub'])
export type SearchScope = z.infer<typeof searchScopeSchema>

export const searchEntrySchema = z.object({
  dn: z.string(),
  attributes: z.array(entryAttributeSchema),
})
export type SearchEntry = z.infer<typeof searchEntrySchema>

export const treeNodeSchema = z.object({
  dn: z.string(),
  /** From `hasSubordinates`/`numSubordinates` when the server provides them; otherwise unknown until expanded. */
  hasChildren: z.boolean().optional(),
  objectClasses: z.array(z.string()),
})
export type TreeNode = z.infer<typeof treeNodeSchema>

export const modificationSchema = z.object({
  operation: z.enum(['add', 'delete', 'replace']),
  attribute: z.string().min(1),
  values: z.array(attributeValueSchema),
})

export const entrySchema = z.object({
  dn: z.string(),
  attributes: z.array(entryAttributeSchema),
  /** Change marker read at load time (entryCSN, uSNChanged or modifyTimestamp) for stale detection. */
  changeMarker: z.object({ attribute: z.string(), value: z.string() }).optional(),
})
export type Entry = z.infer<typeof entrySchema>

export const logRecordSchema = z.object({
  id: z.number().int(),
  timestamp: z.string(),
  connectionId: z.string(),
  profileName: z.string(),
  operation: z.enum(['bind', 'search', 'add', 'modify', 'modifyDn', 'delete', 'extended']),
  dn: z.string(),
  resultCode: z.number().int(),
  message: z.string(),
  durationMs: z.number(),
})
export type LogRecord = z.infer<typeof logRecordSchema>

/** The schema of one connection; `available: false` means schema assistance is off (`reason` says why). */
export const schemaStateSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  snapshot: schemaSnapshotSchema,
  warnings: z.array(z.string()),
})
export type SchemaState = z.infer<typeof schemaStateSchema>

// ---------------------------------------------------------------------------
// Invoke operations (request/response)
// ---------------------------------------------------------------------------

function invoke<Req extends z.ZodType, Res extends z.ZodType>(request: Req, response: Res) {
  return { request, response: resultSchema(response) }
}

const connectionRef = z.object({ connectionId: connectionIdSchema })

export const invokeContract = {
  'profiles.list': invoke(z.object({}), z.array(profileSchema)),
  'profiles.save': invoke(profileInputSchema, profileSchema),
  'profiles.delete': invoke(z.object({ id: z.string().min(1) }), z.null()),
  'profiles.duplicate': invoke(z.object({ id: z.string().min(1) }), profileSchema),
  'profiles.trustCertificate': invoke(
    z.object({ id: z.string().min(1), fingerprint256: z.string() }),
    profileSchema,
  ),
  /** Opens a file dialog in main; null when the user cancels. */
  'profiles.importCaCertificate': invoke(
    z.object({}),
    z.object({ pem: z.string(), info: certificateInfoSchema }).nullable(),
  ),
  'secrets.canSavePasswords': invoke(
    z.object({}),
    z.object({ available: z.boolean(), reason: z.string().optional() }),
  ),

  'connection.test': invoke(profileInputSchema, z.object({ rootDse: rootDseSchema })),
  'connection.connect': invoke(
    z.object({
      profileId: z.string().min(1),
      password: z.string().optional(),
      savePassword: z.boolean().optional(),
    }),
    z.object({
      connectionId: connectionIdSchema,
      rootDse: rootDseSchema,
      /** Set when the connection succeeded but the password could not be saved. */
      passwordSaveError: z.string().optional(),
    }),
  ),
  'connection.disconnect': invoke(connectionRef, z.null()),

  'entry.read': invoke(
    connectionRef.extend({ dn: dnSchema, includeOperational: z.boolean() }),
    entrySchema.nullable(),
  ),
  'entry.add': invoke(
    connectionRef.extend({ dn: dnSchema, attributes: z.array(entryAttributeSchema) }),
    z.null(),
  ),
  'entry.modify': invoke(
    connectionRef.extend({
      dn: dnSchema,
      changes: z.array(modificationSchema).min(1),
      assert: z.object({ attribute: z.string(), value: z.string() }).optional(),
    }),
    z.null(),
  ),
  'entry.rename': invoke(
    connectionRef.extend({
      dn: dnSchema,
      newRdn: z.string().min(1),
      deleteOldRdn: z.boolean(),
      newParent: dnSchema.optional(),
    }),
    z.object({ dn: dnSchema }),
  ),
  'entry.delete': invoke(connectionRef.extend({ dn: dnSchema }), z.null()),
  'entry.countSubtree': invoke(
    connectionRef.extend({ dn: dnSchema }),
    // `incomplete` means a server limit stopped the listing, so `count` is a lower bound.
    z.object({ count: z.number().int(), incomplete: z.boolean() }),
  ),

  'schema.get': invoke(connectionRef, schemaStateSchema),
  'schema.reload': invoke(connectionRef, schemaStateSchema),

  'binary.describeCertificate': invoke(z.object({ bytes: z.instanceof(Uint8Array) }), certificateInfoSchema),
  'binary.saveToFile': invoke(
    z.object({ bytes: z.instanceof(Uint8Array), suggestedName: z.string() }),
    z.boolean(),
  ),
  'binary.readFromFile': invoke(z.object({}), z.instanceof(Uint8Array).nullable()),

  /** Recent searches of a profile, most recent first (directory-search spec: recent searches). */
  'history.list': invoke(
    z.object({ profileId: z.string().min(1) }),
    z.array(
      z.object({
        base: z.string(),
        scope: searchScopeSchema,
        filter: z.string(),
        attributes: z.array(z.string()),
        sizeLimit: z.number().int().min(0),
      }),
    ),
  ),
  'settings.get': invoke(z.object({}), settingsSchema),
  'settings.update': invoke(settingsSchema.partial(), settingsSchema),

  'clipboard.writeText': invoke(z.object({ text: z.string() }), z.null()),
} as const

export type InvokeContract = typeof invokeContract
export type InvokeName = keyof InvokeContract
export type InvokeRequest<N extends InvokeName> = z.input<InvokeContract[N]['request']>
export type InvokeResponse<N extends InvokeName> = z.output<InvokeContract[N]['response']>

// ---------------------------------------------------------------------------
// Streams: started by the renderer, pushed by main, cancellable
// ---------------------------------------------------------------------------

export const operationIdSchema = z.string().min(1)

export const streamContract = {
  /** Children of one tree node, fetched page by page (directory-tree spec). */
  'tree.children': {
    request: connectionRef.extend({ dn: dnSchema }),
    page: z.object({ nodes: z.array(treeNodeSchema) }),
    /** `queued` while waiting for another paged operation on the same connection (design §5). */
    progress: z.object({ loaded: z.number().int(), queued: z.boolean().optional() }),
    done: z.object({ incomplete: z.boolean() }),
  },
  'search.run': {
    request: connectionRef.extend({
      base: dnSchema,
      scope: searchScopeSchema,
      filter: z.string().min(1),
      attributes: z.array(z.string()),
      sizeLimit: z.number().int().min(0),
    }),
    page: z.object({ entries: z.array(searchEntrySchema) }),
    progress: z.object({ loaded: z.number().int(), queued: z.boolean().optional() }),
    done: z.object({ incomplete: z.boolean(), sizeLimitReached: z.boolean() }),
  },
  'entry.deleteSubtree': {
    request: connectionRef.extend({ dn: dnSchema }),
    page: z.object({ deletedDns: z.array(z.string()) }),
    progress: z.object({ deleted: z.number().int(), total: z.number().int() }),
    done: z.object({
      deleted: z.number().int(),
      total: z.number().int(),
      cancelled: z.boolean(),
      /** The entry the server refused, when the delete stopped partway. */
      failedDn: z.string().optional(),
      error: appErrorSchema.optional(),
    }),
  },
  /** Connection state changes, e.g. a connection lost because the server went away. */
  'connection.watch': {
    request: z.object({}),
    page: z.object({ connectionId: connectionIdSchema, state: z.enum(['lost', 'closed']) }),
    progress: z.object({}),
    done: z.object({}),
  },
  'log.follow': {
    request: z.object({}),
    page: z.object({ records: z.array(logRecordSchema) }),
    progress: z.object({}),
    done: z.object({}),
  },
} as const

export type StreamContract = typeof streamContract
export type StreamName = keyof StreamContract
export type StreamRequest<N extends StreamName> = z.input<StreamContract[N]['request']>

export type StreamEvent<N extends StreamName> =
  | { operationId: string; kind: 'page'; data: z.output<StreamContract[N]['page']> }
  | { operationId: string; kind: 'progress'; data: z.output<StreamContract[N]['progress']> }
  | { operationId: string; kind: 'done'; data: z.output<StreamContract[N]['done']> }
  | { operationId: string; kind: 'error'; error: AppError }

/** Builds the event schema for one stream, used by tests and by the preload to validate pushes. */
export function streamEventSchema<N extends StreamName>(name: N) {
  const contract = streamContract[name]
  return z.discriminatedUnion('kind', [
    z.object({ operationId: operationIdSchema, kind: z.literal('page'), data: contract.page }),
    z.object({ operationId: operationIdSchema, kind: z.literal('progress'), data: contract.progress }),
    z.object({ operationId: operationIdSchema, kind: z.literal('done'), data: contract.done }),
    z.object({ operationId: operationIdSchema, kind: z.literal('error'), error: appErrorSchema }),
  ])
}

export const streamStartSchema = z.object({ operationId: operationIdSchema })
export const streamCancelSchema = z.object({ operationId: operationIdSchema })

export { IPC_CHANNELS } from './channels'

/** The API the preload exposes as `window.api`. */
export interface RendererApi {
  invoke<N extends InvokeName>(name: N, request: InvokeRequest<N>): Promise<InvokeResponse<N>>
  /** Starts a stream; returns its operation id and a function that stops listening and cancels it. */
  stream<N extends StreamName>(
    name: N,
    request: StreamRequest<N>,
    onEvent: (event: StreamEvent<N>) => void,
  ): Promise<{ operationId: string; cancel: () => void }>
}
