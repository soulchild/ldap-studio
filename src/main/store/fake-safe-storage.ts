/** Test double for Electron's safeStorage. Not secure; only makes the plain text unrecognizable. */
import type { SafeStorageLike } from './secrets'

export class FakeSafeStorage implements SafeStorageLike {
  available = true
  backend = 'gnome_libsecret'
  failDecrypt = false

  isEncryptionAvailable(): boolean {
    return this.available
  }

  encryptString(plainText: string): Buffer {
    return Buffer.from(Buffer.from(`enc:${plainText}`, 'utf8').map((byte) => byte ^ 0x5a))
  }

  decryptString(encrypted: Buffer): string {
    if (this.failDecrypt) {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    }
    const text = Buffer.from(encrypted.map((byte) => byte ^ 0x5a)).toString('utf8')
    if (!text.startsWith('enc:')) {
      throw new Error('not encrypted by this fake')
    }
    return text.slice(4)
  }

  getSelectedStorageBackend(): string {
    return this.backend
  }
}
