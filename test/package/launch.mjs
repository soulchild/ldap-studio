/**
 * Launches a packaged build and checks that the workspace appears (task 14.1).
 * Usage: node test/package/launch.mjs <path to the app's executable> [extra Electron arguments]
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

const executablePath = process.argv[2]
if (!executablePath) {
  console.error('usage: node test/package/launch.mjs <executable>')
  process.exit(2)
}
const dataDirectory = mkdtempSync(join(tmpdir(), 'ldap-studio-package-'))
const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${dataDirectory}`, ...process.argv.slice(3)],
})
try {
  const window = await app.firstWindow()
  await window
    .getByRole('heading', { name: 'Connections' })
    .or(window.getByText('Connections'))
    .first()
    .waitFor()
  const info = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    electron: process.versions.electron,
  }))
  console.log(`launched ${executablePath}: ${JSON.stringify(info)}`)
  if (!info.packaged) {
    throw new Error('the app does not report itself as packaged')
  }
} finally {
  await app.close()
  rmSync(dataDirectory, { recursive: true, force: true })
}
