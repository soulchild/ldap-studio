/**
 * Runs electron-vite (`dev` or `preview`) so that on macOS the menu bar, Dock, Cmd+Tab and the
 * About panel show "LDAP Studio" and its icon instead of Electron's.
 *
 * macOS takes the app name from the app bundle, and in development the app runs inside
 * Electron's own bundle. This keeps a renamed copy of that bundle in `.dev-app/` (git-ignored),
 * leaving the installed Electron package untouched, and points electron-vite at the copy.
 * Packaged builds are named by electron-builder and need none of this. Elsewhere it only runs
 * electron-vite.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const NAME = 'LDAP Studio'
const ICON = resolve('build', 'icon.png')

/** Builds an .icns from the 1024 px PNG with the tools macOS ships (sips, iconutil). */
function makeIcns(png, icns) {
  const iconset = join(mkdtempSync(join(tmpdir(), 'ldap-studio-icon-')), 'icon.iconset')
  execFileSync('mkdir', [iconset])
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [
      [1, ''],
      [2, '@2x'],
    ]) {
      const pixels = String(size * scale)
      const out = join(iconset, `icon_${size}x${size}${suffix}.png`)
      execFileSync('sips', ['-z', pixels, pixels, png, '--out', out], { stdio: 'ignore' })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns])
  rmSync(dirname(iconset), { recursive: true, force: true })
}
const command = process.argv[2] ?? 'dev'
const env = { ...process.env }

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url)
  // The electron package exports the path of its binary: …/Electron.app/Contents/MacOS/Electron
  const binary = require('electron')
  const version = require('electron/package.json').version
  const source = dirname(dirname(dirname(binary)))
  const target = resolve('.dev-app', `${NAME}.app`)
  // Rebuilt when Electron or the icon changes.
  const marker = resolve('.dev-app', 'stamp')
  const stamp = `${version} ${createHash('sha256').update(readFileSync(ICON)).digest('hex').slice(0, 16)}`
  const current = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
  if (existsSync(source) && current !== stamp) {
    rmSync(resolve('.dev-app'), { recursive: true, force: true })
    execFileSync('ditto', [source, target])
    const plist = join(target, 'Contents', 'Info.plist')
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('plutil', ['-replace', key, '-string', NAME, plist])
    }
    // The bundle icon is what Finder, the Dock and the About panel show.
    const iconFile = execFileSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', plist], {
      encoding: 'utf8',
    }).trim()
    makeIcns(ICON, join(target, 'Contents', 'Resources', iconFile))
    // Editing the bundle invalidates its ad-hoc signature; sign the copy again.
    execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'ignore' })
    writeFileSync(marker, stamp)
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
