/**
 * The app's name, icon and About panel. Without this, development builds and parts of the
 * native UI show Electron's name and icon.
 */
import { join } from 'node:path'
import { app, nativeImage } from 'electron'

export const APP_NAME = 'LDAP Studio'

/** The app icon: copied next to the app resources in packaged builds, from build/ in development. */
export function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png')
}

/**
 * Call before the app is ready. Renaming the app would also move its default data folder, so
 * the folder in use until now (or the one given with --user-data-dir) is kept explicitly.
 */
export function applyIdentity(): void {
  const userData = app.getPath('userData')
  app.setName(APP_NAME)
  app.setPath('userData', userData)
}

/** Call once the app is ready. */
export function applyAboutPanel(): void {
  const icon = iconPath()
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    // macOS shows `version` in parentheses after the version; there is no separate build number.
    version: '',
    copyright: 'A fast, modern LDAP directory browser and editor.',
    iconPath: icon,
  })
  // Development runs inside Electron's own app bundle, whose Dock icon is Electron's.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(icon))
  }
}
