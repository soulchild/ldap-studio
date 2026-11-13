import { describe, expect, it } from 'vitest'
import { FakeSafeStorage } from './fake-safe-storage'
import { StorageError } from './json-store'
import { SecretBox } from './secrets'

describe('SecretBox', () => {
  it('encrypts and decrypts when the system keychain is available', async () => {
    const box = new SecretBox(new FakeSafeStorage(), 'darwin')
    expect(await box.availability()).toEqual({ available: true })
    const encrypted = await box.encrypt('hunter2')
    expect(encrypted).not.toContain('hunter2')
    expect(Buffer.from(encrypted, 'base64').toString('utf8')).not.toContain('hunter2')
    expect(await box.decrypt(encrypted)).toEqual({ plainText: 'hunter2', shouldReEncrypt: false })
  })

  it('passes on that the keychain wants a password encrypted again, e.g. after a key rotation', async () => {
    const storage = new FakeSafeStorage()
    const box = new SecretBox(storage, 'darwin')
    const encrypted = await box.encrypt('hunter2')
    storage.keyVersion = 2
    expect(await box.decrypt(encrypted)).toEqual({ plainText: 'hunter2', shouldReEncrypt: true })
  })

  it('refuses to save when encryption is unavailable', async () => {
    const storage = new FakeSafeStorage()
    storage.available = false
    const box = new SecretBox(storage, 'win32')
    expect(await box.availability()).toMatchObject({
      available: false,
      reason: expect.stringContaining('keychain'),
    })
    await expect(box.encrypt('hunter2')).rejects.toThrow(StorageError)
  })

  it.each(['basic_text', 'unknown'])('refuses the weak Linux backend %s', async (backend) => {
    const storage = new FakeSafeStorage()
    storage.backend = backend
    const box = new SecretBox(storage, 'linux')
    expect(await box.availability()).toMatchObject({
      available: false,
      reason: expect.stringContaining('keyring'),
    })
    await expect(box.encrypt('hunter2')).rejects.toThrow(StorageError)
  })

  it.each(['gnome_libsecret', 'kwallet5', 'kwallet6'])(
    'accepts the Linux keyring backend %s',
    async (backend) => {
      const storage = new FakeSafeStorage()
      storage.backend = backend
      expect(await new SecretBox(storage, 'linux').availability()).toEqual({ available: true })
    },
  )

  it('ignores the backend on platforms other than Linux', async () => {
    const storage = new FakeSafeStorage()
    storage.backend = 'basic_text'
    expect(await new SecretBox(storage, 'darwin').availability()).toEqual({ available: true })
  })

  it('reports a password that can no longer be decrypted as a storage error', async () => {
    const storage = new FakeSafeStorage()
    const box = new SecretBox(storage, 'darwin')
    const encrypted = await box.encrypt('hunter2')
    storage.failDecrypt = true
    await expect(box.decrypt(encrypted)).rejects.toThrow(/could not be decrypted/)
  })
})
