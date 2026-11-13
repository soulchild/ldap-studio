/**
 * Password encryption with the operating system's credential protection (design §7):
 * Keychain on macOS, DPAPI on Windows, libsecret or KWallet on Linux, through Electron's
 * `safeStorage`. Where only weak obfuscation is available, saving is refused.
 */
import { StorageError } from './json-store'

/** The part of Electron's `safeStorage` we use; injectable for tests. */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plainText: string): Promise<Buffer>
  /** Also decrypts what the deprecated synchronous `encryptString` stored. */
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  /** Linux only. `basic_text` means a hard-coded key, which is obfuscation rather than encryption. */
  getSelectedStorageBackend?(): string
}

export interface Decrypted {
  plainText: string
  /** The key has changed since, e.g. after a rotation: store the password again with `encrypt`. */
  shouldReEncrypt: boolean
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

  async availability(): Promise<SecretAvailability> {
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) {
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
  async encrypt(plainText: string): Promise<string> {
    const { available, reason } = await this.availability()
    if (!available) {
      throw new StorageError(reason)
    }
    return (await this.safeStorage.encryptStringAsync(plainText)).toString('base64')
  }

  async decrypt(encrypted: string): Promise<Decrypted> {
    try {
      const { result, shouldReEncrypt } = await this.safeStorage.decryptStringAsync(
        Buffer.from(encrypted, 'base64'),
      )
      return { plainText: result, shouldReEncrypt }
    } catch {
      throw new StorageError(
        'The saved password could not be decrypted, for example because the keychain changed. Enter the password again.',
      )
    }
  }
}
