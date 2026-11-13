/** Launches the built app with a throwaway data directory. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  dataDirectory: string
  /** True when this launch created the data directory, so closing it removes the directory. */
  ownsDirectory: boolean
  close: () => Promise<void>
}

/**
 * At most this many app instances run at once. Tests run in one worker (playwright.config.ts),
 * so this module-level count covers the whole run.
 */
export const MAX_OPEN_APPS = 5
let openApps = 0
const waiting: (() => void)[] = []

async function acquireSlot(): Promise<void> {
  if (openApps >= MAX_OPEN_APPS) {
    await new Promise<void>((resolveSlot) => waiting.push(resolveSlot))
  }
  openApps++
}

function releaseSlot(): void {
  openApps--
  waiting.shift()?.()
}

export async function launchApp(options: { dataDirectory?: string } = {}): Promise<LaunchedApp> {
  const dataDirectory = options.dataDirectory ?? mkdtempSync(join(tmpdir(), 'ldap-studio-e2e-'))
  await acquireSlot()
  let app: ElectronApplication
  try {
    app = await electron.launch({
      args: [
        resolve(__dirname, '../..'),
        `--user-data-dir=${dataDirectory}`,
        // Without a desktop session Electron falls back to basic_text, which the app refuses for
        // passwords. CI provides a keyring through the Secret Service (.github/workflows/ci.yml).
        ...(process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
      ],
      // LDAP_STUDIO_E2E also opens the window without taking focus (src/main/index.ts).
      env: { ...process.env, LDAP_STUDIO_E2E: '1' },
      // Playwright emulates a light colour scheme by default, which would hide the app's own theming.
      colorScheme: null,
    })
  } catch (error) {
    releaseSlot()
    throw error
  }
  // Tests also close apps directly (app.close()) to relaunch them, so count on the close event.
  app.once('close', releaseSlot)
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return withClose(app, window, dataDirectory, !options.dataDirectory)
}

function withClose(
  app: ElectronApplication,
  window: Page,
  dataDirectory: string,
  ownsDirectory: boolean,
): LaunchedApp {
  return {
    app,
    window,
    dataDirectory,
    ownsDirectory,
    close: async () => {
      await app.close()
      if (ownsDirectory) {
        rmSync(dataDirectory, { recursive: true, force: true })
      }
    },
  }
}

/**
 * Closes the app and starts it again on the same data directory, e.g. to check that something
 * persists. The returned close() closes the new app (and removes the directory if the first
 * launch created it), so no instance is left running.
 */
export async function relaunch(previous: LaunchedApp): Promise<LaunchedApp> {
  await previous.app.close()
  const next = await launchApp({ dataDirectory: previous.dataDirectory })
  return withClose(next.app, next.window, previous.dataDirectory, previous.ownsDirectory)
}

/** Opens an entry with the Go to DN dialog (Cmd/Ctrl+L), as a user would. */
export async function goToDn(page: Page, dn: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+l')
  const field = page.getByRole('dialog', { name: 'Go to DN' }).getByLabel('Go to DN')
  await field.fill(dn)
  await field.press('Enter')
}
