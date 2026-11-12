/**
 * The main process's application state: profile, settings and history stores, the operation
 * log, and the open sessions. IPC handlers (handlers.ts) are thin wrappers around this.
 */
import { randomUUID } from 'node:crypto'
import type { Profile, RootDse } from '@shared/ipc'
import { AppErrorException, NotConnectedError } from '../ldap/errors'
import { OperationLog } from '../ldap/oplog'
import { LdapSession, type SessionConfig } from '../ldap/session'
import { loadSchema } from '../schema/service'
import { HistoryStore } from '../store/history'
import { StorageError } from '../store/json-store'
import { ProfileStore } from '../store/profiles'
import type { SecretBox } from '../store/secrets'
import { SettingsStore } from '../store/settings'

export type ConnectionEvent = { connectionId: string; state: 'lost' | 'closed' }

interface OpenConnection {
  session: LdapSession
  profile: Profile
}

export class AppServices {
  readonly profiles: ProfileStore
  readonly history: HistoryStore
  readonly settings: SettingsStore
  readonly log = new OperationLog()
  private readonly connections = new Map<string, OpenConnection>()
  private readonly listeners = new Set<(event: ConnectionEvent) => void>()

  constructor(
    dataDirectory: string,
    readonly secrets: SecretBox,
    /** Called when a connection ends, so its running streams can be aborted. */
    private readonly onConnectionEnded: (connectionId: string) => void = () => undefined,
  ) {
    this.profiles = new ProfileStore(dataDirectory, secrets)
    this.history = new HistoryStore(dataDirectory)
    this.settings = new SettingsStore(dataDirectory)
  }

  onConnectionEvent(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The open session for a connection, or `NotConnectedError`. */
  session(connectionId: string): LdapSession {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.session.isOpen) {
      throw new NotConnectedError()
    }
    return connection.session
  }

  profileOf(connectionId: string): Profile {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      throw new NotConnectedError()
    }
    return connection.profile
  }

  async connect(request: {
    profileId: string
    password?: string | undefined
    savePassword?: boolean | undefined
  }): Promise<{ connectionId: string; rootDse: RootDse; passwordSaveError?: string }> {
    const profile = await this.profiles.get(request.profileId)
    const password =
      request.password ?? (profile.hasSavedPassword ? await this.profiles.password(profile.id) : undefined)
    const connectionId = randomUUID()
    const result = await LdapSession.open({
      ...sessionConfig(profile, password),
      log: { log: this.log, connectionId, profileName: profile.name },
    })
    if (!result.ok) {
      throw new AppErrorException(result.error)
    }
    const session = result.value
    await loadSchema(session)
    this.connections.set(connectionId, { session, profile })
    session.onConnectionLost(() => {
      this.onConnectionEnded(connectionId)
      this.emit({ connectionId, state: 'lost' })
    })

    let passwordSaveError: string | undefined
    if (request.savePassword && request.password) {
      try {
        await this.profiles.savePassword(profile.id, request.password)
      } catch (error) {
        passwordSaveError = error instanceof StorageError ? error.message : 'The password could not be saved.'
      }
    }
    return { connectionId, rootDse: session.rootDse, ...(passwordSaveError ? { passwordSaveError } : {}) }
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return
    }
    this.connections.delete(connectionId)
    this.onConnectionEnded(connectionId)
    await connection.session.close()
    this.emit({ connectionId, state: 'closed' })
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.disconnect(id)))
  }

  private emit(event: ConnectionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export function sessionConfig(
  profile: Pick<Profile, 'host' | 'port' | 'security' | 'bindDn' | 'caCertificates' | 'trustedFingerprint'>,
  password: string | undefined,
): SessionConfig {
  return {
    host: profile.host,
    port: profile.port,
    security: profile.security,
    bindDn: profile.bindDn,
    password,
    caCertificates: profile.caCertificates,
    trustedFingerprint: profile.trustedFingerprint,
  }
}
