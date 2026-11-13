import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { profileSchema, type ProfileInput } from '@shared/ipc'
import { FakeSafeStorage } from './fake-safe-storage'
import { StorageError } from './json-store'
import { ProfileStore } from './profiles'
import { SecretBox } from './secrets'

const PASSWORD = 'correct-horse-battery'
let directory: string
let storage: FakeSafeStorage
let store: ProfileStore

const input = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  name: 'prod',
  host: 'ldap.example.com',
  port: 636,
  security: 'ldaps',
  bindDn: 'cn=admin,dc=example,dc=com',
  baseDn: '',
  caCertificates: [],
  password: { action: 'keep' },
  ...overrides,
})

/** Everything the store wrote to disk, as one string. */
async function filesOnDisk(): Promise<string> {
  const names = await readdir(directory)
  return (await Promise.all(names.map((name) => readFile(join(directory, name), 'utf8')))).join('\n')
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ldap-studio-profiles-'))
  storage = new FakeSafeStorage()
  store = new ProfileStore(directory, new SecretBox(storage, 'darwin'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('ProfileStore', () => {
  it('creates a profile that persists across instances', async () => {
    const created = await store.save(input())
    expect(created).toMatchObject({ name: 'prod', port: 636, hasSavedPassword: false })
    const reloaded = new ProfileStore(directory, new SecretBox(storage, 'darwin'))
    expect(await reloaded.list()).toEqual([created])
  })

  it('updates an existing profile', async () => {
    const created = await store.save(input())
    const updated = await store.save(input({ id: created.id, name: 'production', port: 1636 }))
    expect(updated).toMatchObject({ id: created.id, name: 'production', port: 1636 })
    expect(await store.list()).toHaveLength(1)
  })

  it('refuses to update a profile that does not exist', async () => {
    await expect(store.save(input({ id: 'missing' }))).rejects.toBeInstanceOf(StorageError)
  })

  describe('passwords', () => {
    it('saves, keeps and clears the password through the password action', async () => {
      const created = await store.save(input({ password: { action: 'set', value: PASSWORD } }))
      expect(created.hasSavedPassword).toBe(true)
      expect(await store.password(created.id)).toBe(PASSWORD)

      const kept = await store.save(input({ id: created.id, name: 'renamed', password: { action: 'keep' } }))
      expect(kept.hasSavedPassword).toBe(true)
      expect(await store.password(created.id)).toBe(PASSWORD)

      const cleared = await store.save(input({ id: created.id, password: { action: 'clear' } }))
      expect(cleared.hasSavedPassword).toBe(false)
      expect(await store.password(created.id)).toBeUndefined()
    })

    it('never writes the password in plain text', async () => {
      const created = await store.save(input({ password: { action: 'set', value: PASSWORD } }))
      await store.savePassword(created.id, `${PASSWORD}-2`)
      expect(await filesOnDisk()).not.toContain(PASSWORD)
    })

    it('saves a password again when the keychain asks for it, e.g. after a key rotation', async () => {
      const created = await store.save(input({ password: { action: 'set', value: PASSWORD } }))
      const before = await filesOnDisk()
      storage.keyVersion = 2
      expect(await store.password(created.id)).toBe(PASSWORD)
      const after = await filesOnDisk()
      expect(after).not.toBe(before)
      expect(after).toContain((await storage.encryptStringAsync(PASSWORD)).toString('base64'))
      // Once saved with the current key, reading it changes nothing.
      expect(await store.password(created.id)).toBe(PASSWORD)
      expect(await filesOnDisk()).toBe(after)
    })

    it('still returns the password when saving it again fails', async () => {
      const created = await store.save(input({ password: { action: 'set', value: PASSWORD } }))
      const before = await filesOnDisk()
      storage.keyVersion = 2
      storage.available = false
      expect(await store.password(created.id)).toBe(PASSWORD)
      expect(await filesOnDisk()).toBe(before)
    })

    it('never returns the password or its encrypted form to the renderer', async () => {
      const created = await store.save(input({ password: { action: 'set', value: PASSWORD } }))
      for (const profile of [created, ...(await store.list()), await store.get(created.id)]) {
        expect(profileSchema.strict().safeParse(profile).success).toBe(true)
        const serialized = JSON.stringify(profile)
        expect(serialized).not.toContain(PASSWORD)
        expect(serialized).not.toContain((await storage.encryptStringAsync(PASSWORD)).toString('base64'))
      }
    })

    it('refuses to save a password without secure storage and leaves the profile unchanged', async () => {
      const created = await store.save(input())
      storage.available = false
      await expect(
        store.save(input({ id: created.id, name: 'changed', password: { action: 'set', value: PASSWORD } })),
      ).rejects.toBeInstanceOf(StorageError)
      expect((await store.get(created.id)).name).toBe('prod')
      expect(await filesOnDisk()).not.toContain(PASSWORD)
    })
  })

  it('deletes a profile together with its saved password', async () => {
    const created = await store.save(input({ password: { action: 'set', value: PASSWORD } }))
    await store.delete(created.id)
    expect(await store.list()).toEqual([])
    expect(await filesOnDisk()).not.toContain((await storage.encryptStringAsync(PASSWORD)).toString('base64'))
  })

  it('duplicates settings under a distinct name, without the password', async () => {
    const created = await store.save(
      input({
        password: { action: 'set', value: PASSWORD },
        trustedFingerprint: 'AB:CD',
        caCertificates: ['PEM'],
      }),
    )
    const copy = await store.duplicate(created.id)
    const second = await store.duplicate(created.id)
    expect(copy).toMatchObject({
      name: 'prod (copy)',
      host: 'ldap.example.com',
      trustedFingerprint: 'AB:CD',
      caCertificates: ['PEM'],
      hasSavedPassword: false,
    })
    expect(copy.id).not.toBe(created.id)
    expect(second.name).toBe('prod (copy 2)')
    expect(await store.password(copy.id)).toBeUndefined()
  })

  it('remembers a trusted certificate fingerprint', async () => {
    const created = await store.save(input())
    expect((await store.trustCertificate(created.id, 'AA:BB')).trustedFingerprint).toBe('AA:BB')
  })
})
