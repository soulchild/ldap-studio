/**
 * Connection profiles in `connections.json` (connection-management spec). The renderer only
 * ever receives `Profile` objects, which say whether a password is saved but never carry it.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { profileInputSchema, profileSchema, type Profile, type ProfileInput } from '@shared/ipc'
import { JsonStore, StorageError } from './json-store'
import type { SecretBox } from './secrets'

const storedProfileSchema = profileSchema.omit({ hasSavedPassword: true }).extend({
  /** Base64 output of the OS keychain encryption; never plain text. */
  encryptedPassword: z.string().optional(),
})
type StoredProfile = z.infer<typeof storedProfileSchema>

const fileSchema = z.object({ profiles: z.array(storedProfileSchema) })

export class ProfileStore {
  private readonly file: JsonStore<z.infer<typeof fileSchema>>
  private cache: StoredProfile[] | undefined

  constructor(
    dataDirectory: string,
    private readonly secrets: SecretBox,
  ) {
    this.file = new JsonStore(join(dataDirectory, 'connections.json'), {
      version: 1,
      schema: fileSchema,
      defaults: () => ({ profiles: [] }),
    })
  }

  async list(): Promise<Profile[]> {
    return (await this.load()).map(toProfile)
  }

  async get(id: string): Promise<Profile> {
    return toProfile(await this.find(id))
  }

  /** Creates a profile (no `id`) or updates one, applying the password action. */
  async save(input: ProfileInput): Promise<Profile> {
    const parsed = profileInputSchema.parse(input)
    const profiles = await this.load()
    const existing =
      parsed.id === undefined ? undefined : profiles.find((profile) => profile.id === parsed.id)
    if (parsed.id !== undefined && !existing) {
      throw new StorageError('This connection profile no longer exists.')
    }

    const { password, id: _id, ...fields } = parsed
    const stored: StoredProfile = { ...fields, id: existing?.id ?? randomUUID() }
    if (fields.trustedFingerprint === undefined) {
      delete stored.trustedFingerprint
    }
    if (password.action === 'set') {
      // Encrypt before changing anything, so a refusal leaves the stored profile as it was.
      stored.encryptedPassword = this.secrets.encrypt(password.value)
    } else if (password.action === 'keep' && existing?.encryptedPassword) {
      stored.encryptedPassword = existing.encryptedPassword
    }

    const next = existing
      ? profiles.map((profile) => (profile.id === existing.id ? stored : profile))
      : [...profiles, stored]
    await this.persist(next)
    return toProfile(stored)
  }

  /** Removes the profile and its saved password. */
  async delete(id: string): Promise<void> {
    await this.find(id)
    await this.persist((await this.load()).filter((profile) => profile.id !== id))
  }

  /** Copies a profile's settings under a new, distinct name, without the saved password. */
  async duplicate(id: string): Promise<Profile> {
    const source = await this.find(id)
    const profiles = await this.load()
    const { encryptedPassword: _password, ...settings } = source
    const copy: StoredProfile = { ...settings, id: randomUUID(), name: copyName(source.name, profiles) }
    await this.persist([...profiles, copy])
    return toProfile(copy)
  }

  /** Remembers a server certificate the user chose to trust for this profile. */
  async trustCertificate(id: string, fingerprint256: string): Promise<Profile> {
    const source = await this.find(id)
    const updated = { ...source, trustedFingerprint: fingerprint256 }
    await this.persist((await this.load()).map((profile) => (profile.id === id ? updated : profile)))
    return toProfile(updated)
  }

  /** Saves or replaces just the password, e.g. when the user ticks "save password" in the prompt. */
  async savePassword(id: string, password: string): Promise<void> {
    const source = await this.find(id)
    const updated = { ...source, encryptedPassword: this.secrets.encrypt(password) }
    await this.persist((await this.load()).map((profile) => (profile.id === id ? updated : profile)))
  }

  /** The decrypted password for connecting, if one is saved. Main process only. */
  async password(id: string): Promise<string | undefined> {
    const profile = await this.find(id)
    return profile.encryptedPassword === undefined
      ? undefined
      : this.secrets.decrypt(profile.encryptedPassword)
  }

  private async find(id: string): Promise<StoredProfile> {
    const profile = (await this.load()).find((candidate) => candidate.id === id)
    if (!profile) {
      throw new StorageError('This connection profile no longer exists.')
    }
    return profile
  }

  private async load(): Promise<StoredProfile[]> {
    this.cache ??= (await this.file.read()).profiles
    return this.cache
  }

  private async persist(profiles: StoredProfile[]): Promise<void> {
    await this.file.write({ profiles })
    this.cache = profiles
  }
}

function toProfile(stored: StoredProfile): Profile {
  const { encryptedPassword, ...profile } = stored
  return { ...profile, hasSavedPassword: encryptedPassword !== undefined }
}

function copyName(name: string, profiles: StoredProfile[]): string {
  const taken = new Set(profiles.map((profile) => profile.name))
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name} (copy)` : `${name} (copy ${n})`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}
