/**
 * Stops the run before any test when the app cannot save passwords. Most tests save a profile with
 * a password and then connect; without encryption the app refuses to store it (secrets.ts), every
 * connect asks for the password instead, and each of those tests waits for its full timeout.
 */
import { launchApp } from './app'

/** Linux backends secrets.ts refuses: `basic_text` is a hard-coded key, not encryption. */
const WEAK_LINUX_BACKENDS = new Set(['basic_text', 'unknown'])

export default async function globalSetup(): Promise<void> {
  const launched = await launchApp()
  try {
    const storage = await launched.app.evaluate(async ({ safeStorage }) => ({
      available: await safeStorage.isAsyncEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined,
    }))
    if (!storage.available || (storage.backend !== undefined && WEAK_LINUX_BACKENDS.has(storage.backend))) {
      throw new Error(
        `Password storage is not available (backend: ${storage.backend ?? 'none'}), so the app cannot save ` +
          'passwords and most end-to-end tests would time out. On Linux, run the tests with an unlocked ' +
          'keyring, as .github/workflows/ci.yml does.',
      )
    }
  } finally {
    await launched.close()
  }
}
