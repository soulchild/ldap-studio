/** Test double for Electron's safeStorage. Not secure; only makes the plain text unrecognizable. */
import type { SafeStorageLike } from './secrets'

export class FakeSafeStorage implements SafeStorageLike {
  available = true
  backend = 'gnome_libsecret'
  failDecrypt = false
  /** Raise to simulate a key rotation: older ciphertext then asks to be encrypted again. */
  keyVersion = 1

  async isAsyncEncryptionAvailable(): Promise<boolean> {
    return this.available
  }

  async encryptStringAsync(plainText: string): Promise<Buffer> {
    return scramble(Buffer.from(`enc${this.keyVersion}:${plainText}`, 'utf8'))
  }

  async decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    if (this.failDecrypt) {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.')
    }
    const text = scramble(encrypted).toString('utf8')
    const match = /^enc(\d+):/.exec(text)
    if (!match) {
      throw new Error('not encrypted by this fake')
    }
    return { result: text.slice(match[0].length), shouldReEncrypt: Number(match[1]) !== this.keyVersion }
  }

  getSelectedStorageBackend(): string {
    return this.backend
  }
}

function scramble(bytes: Buffer): Buffer {
  return Buffer.from(bytes.map((byte) => byte ^ 0x5a))
}
