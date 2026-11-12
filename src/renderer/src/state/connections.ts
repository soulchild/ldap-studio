/**
 * Connection profiles and their live state (connection-management spec). The connect flow
 * lives here: it asks for a password when none is saved, asks again after a wrong one, and
 * shows the certificate dialog for an untrusted server.
 */
import { create } from 'zustand'
import { useSchema } from './schema'
import { useTree } from './tree'
import type { AppError, Profile, ProfileInput, Result, RootDse } from '@shared/ipc'

export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; connectionId: string; rootDse: RootDse }
  /** `connectionId` is kept for a lost connection, whose tree stays visible read-only. */
  | { status: 'error'; error: AppError; lost?: boolean; connectionId?: string }

export type ConnectDialog =
  | { kind: 'password'; profileId: string; error?: string }
  | {
      kind: 'certificate'
      profileId: string
      error: Extract<AppError, { kind: 'certificateUntrusted' }>
      password?: string | undefined
      savePassword?: boolean | undefined
    }

interface ConnectionsStore {
  profiles: Profile[]
  states: Record<string, ConnectionState>
  /** The connection whose directory the tree shows. */
  activeProfileId: string | undefined
  dialog: ConnectDialog | undefined
  /** A one-line message for the user, e.g. that a password could not be saved. */
  notice: string | undefined

  load: () => Promise<void>
  watch: () => Promise<void>
  save: (input: ProfileInput) => Promise<Result<Profile>>
  remove: (id: string) => Promise<Result<null>>
  duplicate: (id: string) => Promise<Result<Profile>>
  setActive: (id: string) => void
  connect: (id: string, credentials?: { password?: string; savePassword?: boolean }) => Promise<void>
  disconnect: (id: string) => Promise<void>
  trustAndConnect: () => Promise<void>
  closeDialog: () => void
  dismissNotice: () => void
}

const isWrongPassword = (error: AppError) => error.kind === 'ldap' && error.resultCode === 49

export const useConnections = create<ConnectionsStore>((set, get) => {
  const setState = (id: string, state: ConnectionState) =>
    set((store) => ({ states: { ...store.states, [id]: state } }))

  const replaceProfile = (profile: Profile) =>
    set((store) => {
      const exists = store.profiles.some((candidate) => candidate.id === profile.id)
      return {
        profiles: exists
          ? store.profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
          : [...store.profiles, profile],
      }
    })

  let watching = false

  return {
    profiles: [],
    states: {},
    activeProfileId: undefined,
    dialog: undefined,
    notice: undefined,

    async load() {
      const result = await window.api.invoke('profiles.list', {})
      if (result.ok) {
        set({ profiles: result.value })
      }
    },

    async watch() {
      if (watching) {
        return
      }
      watching = true
      await window.api.stream('connection.watch', {}, (event) => {
        if (event.kind !== 'page') {
          return
        }
        const { connectionId, state } = event.data
        const entry = Object.entries(get().states).find(
          ([, current]) => current.status === 'connected' && current.connectionId === connectionId,
        )
        if (!entry) {
          return
        }
        if (state === 'lost') {
          setState(entry[0], {
            status: 'error',
            lost: true,
            connectionId,
            error: { kind: 'notConnected', message: 'The connection to the server was lost.' },
          })
        } else {
          useTree.getState().drop(connectionId)
          setState(entry[0], { status: 'disconnected' })
        }
      })
    },

    async save(input) {
      const result = await window.api.invoke('profiles.save', input)
      if (result.ok) {
        replaceProfile(result.value)
      }
      return result
    },

    async remove(id) {
      if (get().states[id]?.status === 'connected') {
        await get().disconnect(id)
      }
      const result = await window.api.invoke('profiles.delete', { id })
      if (result.ok) {
        set((store) => {
          const { [id]: _removed, ...states } = store.states
          return {
            profiles: store.profiles.filter((profile) => profile.id !== id),
            states,
            activeProfileId: store.activeProfileId === id ? undefined : store.activeProfileId,
          }
        })
      }
      return result
    },

    async duplicate(id) {
      const result = await window.api.invoke('profiles.duplicate', { id })
      if (result.ok) {
        replaceProfile(result.value)
      }
      return result
    },

    setActive(id) {
      set({ activeProfileId: id })
    },

    async connect(id, credentials = {}) {
      const profile = get().profiles.find((candidate) => candidate.id === id)
      if (!profile) {
        return
      }
      // Reconnecting after a loss replaces the read-only tree of the lost connection.
      const previous = get().states[id]
      if (previous?.status === 'error' && previous.connectionId) {
        useTree.getState().drop(previous.connectionId)
      }
      if (profile.bindDn !== '' && !profile.hasSavedPassword && credentials.password === undefined) {
        set({ dialog: { kind: 'password', profileId: id } })
        return
      }
      set({ dialog: undefined, activeProfileId: id })
      setState(id, { status: 'connecting' })
      const result = await window.api.invoke('connection.connect', { profileId: id, ...credentials })
      if (result.ok) {
        const { connectionId, rootDse } = result.value
        // Tree roots: the profile's base DN, or else the naming contexts the server advertises.
        useTree.getState().init(connectionId, profile.baseDn ? [profile.baseDn] : rootDse.namingContexts)
        void useSchema.getState().load(connectionId)
        setState(id, { status: 'connected', connectionId, rootDse })
        if (result.value.passwordSaveError) {
          set({ notice: result.value.passwordSaveError })
        } else if (credentials.savePassword) {
          replaceProfile({ ...profile, hasSavedPassword: true })
        }
        return
      }
      const { error } = result
      if (error.kind === 'certificateUntrusted') {
        setState(id, { status: 'disconnected' })
        set({ dialog: { kind: 'certificate', profileId: id, error, ...credentials } })
        return
      }
      if (isWrongPassword(error) && profile.bindDn !== '') {
        setState(id, { status: 'disconnected' })
        set({ dialog: { kind: 'password', profileId: id, error: error.message } })
        return
      }
      setState(id, { status: 'error', error })
    },

    async disconnect(id) {
      const state = get().states[id]
      if (state?.status === 'connected') {
        await window.api.invoke('connection.disconnect', { connectionId: state.connectionId })
      }
      if ((state?.status === 'connected' || state?.status === 'error') && state.connectionId) {
        useTree.getState().drop(state.connectionId)
        useSchema.getState().drop(state.connectionId)
      }
      setState(id, { status: 'disconnected' })
    },

    async trustAndConnect() {
      const dialog = get().dialog
      if (dialog?.kind !== 'certificate') {
        return
      }
      const trusted = await window.api.invoke('profiles.trustCertificate', {
        id: dialog.profileId,
        fingerprint256: dialog.error.certificate.fingerprint256,
      })
      if (!trusted.ok) {
        set({ dialog: undefined, notice: trusted.error.message })
        return
      }
      replaceProfile(trusted.value)
      const credentials = {
        ...(dialog.password !== undefined ? { password: dialog.password } : {}),
        ...(dialog.savePassword !== undefined ? { savePassword: dialog.savePassword } : {}),
      }
      await get().connect(dialog.profileId, credentials)
    },

    closeDialog() {
      set({ dialog: undefined })
    },

    dismissNotice() {
      set({ notice: undefined })
    },
  }
})

/** Human-readable text for a connection failure, by kind (test connection and the error state). */
export function describeConnectionError(error: AppError): string {
  switch (error.kind) {
    case 'network':
      return error.message
    case 'tls':
      return error.message
    case 'certificateUntrusted':
      return `${error.message} ${error.reason}`
    case 'startTlsRefused':
      return error.message
    case 'ldap':
      return error.diagnostic && error.diagnostic !== error.message
        ? `${error.message} (${error.diagnostic})`
        : error.message
    default:
      return error.message
  }
}
