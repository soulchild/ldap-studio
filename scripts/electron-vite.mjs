/**
 * Runs electron-vite (`dev` or `preview`) so that on macOS the menu bar, Dock and Cmd+Tab say
 * "LDAP Studio" instead of "Electron".
 *
 * macOS takes the app name from the app bundle, and in development the app runs inside
 * Electron's own bundle. This keeps a renamed copy of that bundle in `.dev-app/` (git-ignored),
 * leaving the installed Electron package untouched, and points electron-vite at the copy.
 * Packaged builds are named by electron-builder and need none of this. Elsewhere it only runs
 * electron-vite.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const NAME = 'LDAP Studio'
const command = process.argv[2] ?? 'dev'
const env = { ...process.env }

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url)
  // The electron package exports the path of its binary: …/Electron.app/Contents/MacOS/Electron
  const binary = require('electron')
  const version = require('electron/package.json').version
  const source = dirname(dirname(dirname(binary)))
  const target = resolve('.dev-app', `${NAME}.app`)
  const marker = resolve('.dev-app', 'electron-version')
  const current = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
  if (existsSync(source) && current !== version) {
    rmSync(resolve('.dev-app'), { recursive: true, force: true })
    execFileSync('ditto', [source, target])
    const plist = join(target, 'Contents', 'Info.plist')
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('plutil', ['-replace', key, '-string', NAME, plist])
    }
    // Editing Info.plist invalidates the bundle's ad-hoc signature; sign the copy again.
    execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'ignore' })
    writeFileSync(marker, version)
  }
  if (existsSync(target)) {
    env.ELECTRON_EXEC_PATH = join(target, 'Contents', 'MacOS', 'Electron')
  }
}

const child = spawn('electron-vite', [command, ...process.argv.slice(3)], {
  stdio: 'inherit',
  env,
  shell: true,
})
child.on('exit', (code) => process.exit(code ?? 1))
