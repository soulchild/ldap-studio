import { describe, expect, it } from 'vitest'
import { FakeSafeStorage } from './fake-safe-storage'
import { StorageError } from './json-store'
import { SecretBox } from './secrets'

describe('SecretBox', () => {
  it('encrypts and decrypts when the system keychain is available', () => {
    const box = new SecretBox(new FakeSafeStorage(), 'darwin')
    expect(box.availability()).toEqual({ available: true })
    const encrypted = box.encrypt('hunter2')
    expect(encrypted).not.toContain('hunter2')
    expect(Buffer.from(encrypted, 'base64').toString('utf8')).not.toContain('hunter2')
    expect(box.decrypt(encrypted)).toBe('hunter2')
  })

  it('refuses to save when encryption is unavailable', () => {
    const storage = new FakeSafeStorage()
    storage.available = false
    const box = new SecretBox(storage, 'win32')
    expect(box.availability()).toMatchObject({
      available: false,
      reason: expect.stringContaining('keychain'),
    })
    expect(() => box.encrypt('hunter2')).toThrow(StorageError)
  })

  it.each(['basic_text', 'unknown'])('refuses the weak Linux backend %s', (backend) => {
    const storage = new FakeSafeStorage()
    storage.backend = backend
    const box = new SecretBox(storage, 'linux')
    expect(box.availability()).toMatchObject({ available: false, reason: expect.stringContaining('keyring') })
    expect(() => box.encrypt('hunter2')).toThrow(StorageError)
  })

  it.each(['gnome_libsecret', 'kwallet5', 'kwallet6'])('accepts the Linux keyring backend %s', (backend) => {
    const storage = new FakeSafeStorage()
    storage.backend = backend
    expect(new SecretBox(storage, 'linux').availability()).toEqual({ available: true })
  })

  it('ignores the backend on platforms other than Linux', () => {
    const storage = new FakeSafeStorage()
    storage.backend = 'basic_text'
    expect(new SecretBox(storage, 'darwin').availability()).toEqual({ available: true })
  })

  it('reports a password that can no longer be decrypted as a storage error', () => {
    const storage = new FakeSafeStorage()
    const box = new SecretBox(storage, 'darwin')
    const encrypted = box.encrypt('hunter2')
    storage.failDecrypt = true
    expect(() => box.decrypt(encrypted)).toThrow(/could not be decrypted/)
  })
})
