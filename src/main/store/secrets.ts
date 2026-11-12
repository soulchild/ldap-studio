/**
 * Password encryption with the operating system's credential protection (design §7):
 * Keychain on macOS, DPAPI on Windows, libsecret or KWallet on Linux, through Electron's
 * `safeStorage`. Where only weak obfuscation is available, saving is refused.
 */
import { StorageError } from './json-store'

/** The part of Electron's `safeStorage` we use; injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only. `basic_text` means a hard-coded key, which is obfuscation rather than encryption. */
  getSelectedStorageBackend?(): string
}

export interface SecretAvailability {
  available: boolean
  reason?: string
}

const WEAK_LINUX_BACKENDS = new Set(['basic_text', 'unknown'])

export class SecretBox {
  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  availability(): SecretAvailability {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return {
        available: false,
        reason:
          'The system keychain is not available, so passwords cannot be saved. You will be asked for the password when you connect.',
      }
    }
    if (this.platform === 'linux') {
      const backend = this.safeStorage.getSelectedStorageBackend?.() ?? 'unknown'
      if (WEAK_LINUX_BACKENDS.has(backend)) {
        return {
          available: false,
          reason:
            'No keyring such as GNOME Keyring or KWallet is available, so passwords cannot be stored securely. Install or unlock a keyring to save passwords; until then you will be asked for the password when you connect.',
        }
      }
    }
    return { available: true }
  }

  /** Returns the encrypted password as base64. Throws `StorageError` if it cannot be stored securely. */
  encrypt(plainText: string): string {
    const { available, reason } = this.availability()
    if (!available) {
      throw new StorageError(reason)
    }
    return this.safeStorage.encryptString(plainText).toString('base64')
  }

  decrypt(encrypted: string): string {
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      throw new StorageError(
        'The saved password could not be decrypted, for example because the keychain changed. Enter the password again.',
      )
    }
  }
}
