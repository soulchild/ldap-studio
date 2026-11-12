/**
 * One open connection to a directory server (design §5, §6): transport security, certificate
 * verification, simple bind, and the root DSE. Paged operations and entry operations build on it.
 */
import { isIP } from 'node:net'
import { Client, ResultCodeError } from 'ldapts'
import { parseDnStrict, parentDn, serializeDn } from '@shared/dn'
import type { EntryAttribute, Modification } from '@shared/entry'
import type { AppError, Entry, LogRecord, Result, RootDse, SearchEntry, SecurityMode } from '@shared/ipc'
import { ConnectionWatch } from './connection-watch'
import { NotConnectedError, toAppError } from './errors'
import {
  addEntry,
  ASSERTION_CONTROL_OID,
  deleteEntry,
  modifyDn,
  modifyEntry,
  readEntry,
  type ChangeMarker,
} from './entries'
import { summarizeChanges, type OperationLog } from './oplog'
import { TreeDeleteControl } from './subtree'
import type { IsBinary } from './values'
import { SchemaModel } from '@shared/schema-model'
import type { SchemaState } from '../schema/service'
import {
  PAGED_RESULTS_OID,
  PagedQueue,
  pagedSearch,
  type PagedSearchRequest,
  type PagedSearchResult,
} from './paged'
import {
  tlsOptions,
  trustedCertificates,
  verifyingConnect,
  type TlsRejection,
  type TlsVerification,
} from './tls'

export interface SessionConfig {
  host: string
  port: number
  security: SecurityMode
  /** Empty for an anonymous bind. */
  bindDn: string
  password?: string | undefined
  /** PEM CA certificates trusted in addition to the system roots. */
  caCertificates: string[]
  trustedFingerprint?: string | undefined
  connectTimeoutMs?: number
  operationTimeoutMs?: number
  /** Where operations are recorded; optional so tests and connection checks can skip it. */
  log?: SessionLogTarget | undefined
}

export interface SessionLogTarget {
  log: OperationLog
  connectionId: string
  profileName: string
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
const SCHEMALESS = new SchemaModel({ attributeTypes: [], objectClasses: [], syntaxes: [] })
const DEFAULT_OPERATION_TIMEOUT_MS = 60_000

/** `supportedCapabilities` value that only Active Directory advertises (LDAP_CAP_ACTIVE_DIRECTORY_OID). */
const AD_CAPABILITY = '1.2.840.113556.1.4.800'

const ROOT_DSE_ATTRIBUTES = [
  'namingContexts',
  'supportedControl',
  'supportedExtension',
  'supportedCapabilities',
  'subschemaSubentry',
  'vendorName',
  'vendorVersion',
]

export interface SearchStreamOptions {
  onPage: (entries: SearchEntry[]) => void
  /** Called when the search has to wait for another paged operation on this connection. */
  onQueued?: () => void
  signal?: AbortSignal
}

export class LdapSession {
  private closed = false
  /** Paged operations run one at a time per connection (design §5). */
  readonly pagedQueue = new PagedQueue()
  /** The loaded schema; set by `loadSchema` (schema/service.ts). */
  schema: SchemaState | undefined
  /** Until a schema is loaded: well-known binary attributes and the `;binary` option only. */
  isBinary: IsBinary = (name) => SCHEMALESS.isBinary(name)

  private constructor(
    readonly client: Client,
    readonly rootDse: RootDse,
    readonly config: Readonly<SessionConfig>,
    private readonly watch: ConnectionWatch,
  ) {}

  /** Connects, secures, binds and reads the root DSE. Never throws; failures come back as values. */
  static async open(config: SessionConfig): Promise<Result<LdapSession>> {
    if (config.bindDn !== '' && !config.password) {
      // An empty password would make this an "unauthenticated" bind, which servers treat as anonymous.
      return failure({ kind: 'invalidRequest', message: 'A password is required to bind as this DN.' })
    }
    const rejection: TlsRejection = {}
    const verification: TlsVerification = {
      ca: trustedCertificates(config.caCertificates),
      host: config.host,
      pinnedFingerprint: config.trustedFingerprint,
    }
    const scheme = config.security === 'ldaps' ? 'ldaps' : 'ldap'
    const watch = new ConnectionWatch()
    const client = new Client({
      url: `${scheme}://${urlHost(config.host)}:${config.port}`,
      timeout: config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
      connectTimeout: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      createConnection: watch.plainConnect(),
      createSecureConnection: watch.secureConnect(verifyingConnect(verification, rejection)),
      ...(config.security === 'ldaps' ? { tlsOptions: tlsOptions(verification) } : {}),
    })
    const logBind = (started: number, resultCode: number, message: string) =>
      logOperation(config.log, {
        operation: 'bind',
        dn: config.bindDn,
        resultCode,
        message,
        durationMs: Date.now() - started,
      })

    try {
      if (config.security === 'starttls') {
        const refused = await startTls(client, verification)
        // ldapts sees the handshake as finished even when our certificate check destroyed the socket.
        if (refused || rejection.error) {
          await closeQuietly(client)
          return failure(rejection.error ?? (refused as AppError))
        }
      }
      if (config.bindDn !== '') {
        const started = Date.now()
        try {
          await client.bind(config.bindDn, config.password ?? '')
        } catch (error) {
          const appError = rejection.error ?? toAppError(error)
          logBind(
            started,
            appError.kind === 'ldap' ? appError.resultCode : -1,
            `Simple bind failed: ${appError.message}`,
          )
          throw error
        }
        logBind(started, 0, 'Simple bind')
      } else {
        logBind(Date.now(), 0, 'Anonymous')
      }
      const rootDse = await readRootDse(client)
      return { ok: true, value: new LdapSession(client, rootDse, config, watch) }
    } catch (error) {
      watch.markClosing()
      await closeQuietly(client)
      return failure(rejection.error ?? toAppError(error))
    }
  }

  get supportsPaging(): boolean {
    return this.rootDse.supportedControls.includes(PAGED_RESULTS_OID)
  }

  /**
   * Streams a search page by page through the paged queue. Limits and cancellation end it
   * with partial results; other failures throw (convert with `toAppError`). A search
   * cancelled while still queued throws `CancelledError`.
   */
  search(request: PagedSearchRequest, options: SearchStreamOptions): Promise<PagedSearchResult> {
    return this.pagedQueue.run(
      () =>
        this.logged(
          'search',
          request.base,
          () => {
            this.assertOpen()
            return pagedSearch(this.client, request, {
              supportsPaging: this.supportsPaging,
              isBinary: this.isBinary,
              onPage: (entries) => {
                // A lost connection must not continue; ldapts would reconnect for the next page.
                this.assertOpen()
                options.onPage(entries)
              },
              signal: options.signal,
            })
          },
          (result) =>
            `${request.scope} ${request.filter}: ${result.total} entries${result.incomplete ? ' (incomplete)' : ''}`,
        ),
      { signal: options.signal, onQueued: options.onQueued },
    )
  }

  get supportsAssertion(): boolean {
    return this.rootDse.supportedControls.includes(ASSERTION_CONTROL_OID)
  }

  readEntry(dn: string, includeOperational: boolean): Promise<Entry | null> {
    return this.logged(
      'search',
      dn,
      () => readEntry(this.client, dn, { includeOperational, isBinary: this.isBinary }),
      (entry) => (entry ? 'Read entry' : 'Read entry: no such entry'),
    )
  }

  addEntry(dn: string, attributes: EntryAttribute[]): Promise<void> {
    return this.logged(
      'add',
      dn,
      () => addEntry(this.client, dn, attributes),
      () => `Add with ${attributes.length} attributes`,
    )
  }

  /** One atomic modify; with `assert`, fails with assertionFailed (122) if the entry changed since it was read. */
  modifyEntry(dn: string, changes: Modification[], assert?: ChangeMarker): Promise<void> {
    return this.logged(
      'modify',
      dn,
      () => modifyEntry(this.client, dn, changes, { assert, supportsAssertion: this.supportsAssertion }),
      () => summarizeChanges(changes),
    )
  }

  /** Renames and/or moves an entry and returns its new DN. */
  async renameEntry(request: {
    dn: string
    newRdn: string
    deleteOldRdn: boolean
    newParent?: string | undefined
  }): Promise<string> {
    await this.logged(
      'modifyDn',
      request.dn,
      () => modifyDn(this.client, request),
      () =>
        `New RDN ${request.newRdn}${request.newParent !== undefined ? ` under ${request.newParent}` : ''}${request.deleteOldRdn ? '' : ', keeping the old RDN value'}`,
    )
    const parent = request.newParent ?? serializeDn(parentDn(parseDnStrict(request.dn)) ?? [])
    return parent === '' ? request.newRdn : `${request.newRdn},${parent}`
  }

  deleteEntry(dn: string): Promise<void> {
    return this.logged(
      'delete',
      dn,
      () => deleteEntry(this.client, dn),
      () => 'Delete',
    )
  }

  /** Reads the subschema entry's definitions, or undefined if this account cannot see it. */
  readSubschema(
    dn: string,
  ): Promise<{ objectClasses: string[]; attributeTypes: string[]; ldapSyntaxes: string[] } | undefined> {
    return this.logged(
      'search',
      dn,
      async () => {
        const { searchEntries } = await this.client.search(dn, {
          scope: 'base',
          filter: '(objectClass=subschema)',
          attributes: ['objectClasses', 'attributeTypes', 'ldapSyntaxes'],
        })
        const entry = searchEntries[0]
        if (!entry) {
          return undefined
        }
        const strings = (name: string) => [entry[name] ?? []].flat().map(String)
        return {
          objectClasses: strings('objectClasses'),
          attributeTypes: strings('attributeTypes'),
          ldapSyntaxes: strings('ldapSyntaxes'),
        }
      },
      (result) =>
        result ? `Read schema: ${result.attributeTypes.length} attribute types` : 'Schema not readable',
    )
  }

  /** Deletes an entry and everything below it with the Tree Delete control (servers that advertise it). */
  deleteTree(dn: string): Promise<void> {
    return this.logged(
      'delete',
      dn,
      () => this.client.del(dn, new TreeDeleteControl()),
      () => 'Tree delete',
    )
  }

  /** False after `close()` or once the connection was lost. */
  get isOpen(): boolean {
    return !this.closed && !this.watch.isLost
  }

  get isLost(): boolean {
    return this.watch.isLost
  }

  /** Called once if the server or network drops the connection (not after `close()`). */
  onConnectionLost(listener: () => void): () => void {
    return this.watch.onLost(listener)
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    this.watch.markClosing()
    await closeQuietly(this.client)
  }

  private assertOpen(): void {
    if (!this.isOpen) {
      throw new NotConnectedError(
        this.closed
          ? 'This connection was closed.'
          : 'The connection to the server was lost. Reconnect to continue.',
      )
    }
  }

  /** Runs one operation, refusing it on a lost connection, and records it in the operation log. */
  private async logged<T>(
    operation: LogRecord['operation'],
    dn: string,
    run: () => Promise<T>,
    describe: (result: T) => string,
  ): Promise<T> {
    this.assertOpen()
    const started = Date.now()
    try {
      const result = await run()
      logOperation(this.config.log, {
        operation,
        dn,
        resultCode: 0,
        message: describe(result),
        durationMs: Date.now() - started,
      })
      return result
    } catch (error) {
      const appError = toAppError(error)
      logOperation(this.config.log, {
        operation,
        dn,
        resultCode: appError.kind === 'ldap' ? appError.resultCode : -1,
        message: appError.message,
        durationMs: Date.now() - started,
      })
      throw error
    }
  }
}

function logOperation(
  target: SessionLogTarget | undefined,
  record: Pick<LogRecord, 'operation' | 'dn' | 'resultCode' | 'message' | 'durationMs'>,
): void {
  target?.log.record({ connectionId: target.connectionId, profileName: target.profileName, ...record })
}

/** Upgrades with StartTLS. Returns an error if the server refuses; never falls back to plain LDAP. */
async function startTls(client: Client, verification: TlsVerification): Promise<AppError | undefined> {
  try {
    await client.startTLS(tlsOptions(verification))
    return undefined
  } catch (error) {
    if (error instanceof ResultCodeError) {
      return {
        kind: 'startTlsRefused',
        message: `The server refused StartTLS (${toAppError(error).message}) The connection was closed without sending credentials.`,
      }
    }
    throw error
  }
}

export async function readRootDse(client: Client): Promise<RootDse> {
  const { searchEntries } = await client.search('', {
    scope: 'base',
    filter: '(objectClass=*)',
    attributes: ROOT_DSE_ATTRIBUTES,
  })
  const entry = searchEntries[0] ?? { dn: '' }
  const strings = (name: string): string[] =>
    [entry[name] ?? []]
      .flat()
      .map((value) => (Buffer.isBuffer(value) ? value.toString('utf8') : String(value)))
  const first = (name: string): string | undefined => strings(name)[0]

  const rootDse: RootDse = {
    namingContexts: strings('namingContexts'),
    supportedControls: strings('supportedControl'),
    supportedExtensions: strings('supportedExtension'),
    isActiveDirectory: strings('supportedCapabilities').includes(AD_CAPABILITY),
  }
  const subschemaSubentry = first('subschemaSubentry')
  if (subschemaSubentry) {
    rootDse.subschemaSubentry = subschemaSubentry
  }
  const vendorName = first('vendorName')
  if (vendorName) {
    rootDse.vendorName = vendorName
  }
  return rootDse
}

function urlHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

function failure(error: AppError): Result<never> {
  return { ok: false, error }
}

async function closeQuietly(client: Client): Promise<void> {
  try {
    await client.unbind()
  } catch {
    // Already closed or never connected.
  }
}
