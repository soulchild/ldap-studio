import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, screen, session } from 'electron'
import { registerHandlers } from './app/handlers'
import { AppServices } from './app/services'
import { importCaCertificate } from './app/certificates'
import { readValueFile, writeValueFile } from './app/files'
import { applyAboutPanel, applyIdentity, iconPath } from './app/identity'
import { installMenu } from './app/menu'
import { applyTheme, windowBackground } from './app/theme'
import { restorableBounds, trackWindowState } from './app/window-state'
import { IpcRouter, type SenderLike } from './ipc/router'
import { SecretBox } from './store/secrets'

applyIdentity()

/** webContents ids of the app's own windows; IPC from anything else is refused. */
const appWindows = new Set<number>()

async function createMainWindow(services: AppServices): Promise<BrowserWindow> {
  const settings = await services.settings.get().catch(() => undefined)
  const saved = restorableBounds(
    settings?.windowBounds,
    screen.getAllDisplays().map((display) => display.workArea),
  )
  const window = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 800,
    minHeight: 500,
    // Windows and Linux take the window icon from here; macOS uses the app bundle's.
    ...(process.platform === 'darwin' ? {} : { icon: iconPath() }),
    // Matches the theme before the page renders, so a dark window does not flash white.
    backgroundColor: windowBackground(),
    show: false,
    title: 'LDAP Studio',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // End-to-end tests may inspect renderer state; never set in normal use.
      ...(process.env['LDAP_STUDIO_E2E'] === '1' ? { additionalArguments: ['--ldap-studio-e2e'] } : {}),
    },
  })
  const contentsId = window.webContents.id
  appWindows.add(contentsId)
  window.on('closed', () => appWindows.delete(contentsId))

  // The UI is a single local page: it never navigates, opens windows or embeds other content.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  trackWindowState(window, services.settings)
  window.once('ready-to-show', () => {
    if (saved?.maximized) {
      window.maximize()
    }
    // End-to-end test runs open many windows; they must not take focus from the user.
    if (process.env['LDAP_STUDIO_E2E'] === '1') {
      window.showInactive()
    } else {
      window.show()
    }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(async () => {
  applyAboutPanel()
  // No camera, microphone, notifications, geolocation and so on.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  const router = new IpcRouter(ipcMain, (sender: SenderLike) => appWindows.has(sender.id))
  const services = new AppServices(app.getPath('userData'), new SecretBox(safeStorage), (connectionId) =>
    router.cancelConnection(connectionId),
  )
  registerHandlers(router, services)
  // A theme change from the renderer goes through settings.update; apply it to native UI too.
  router.invoke('settings.update', async (changes) => {
    const next = await services.settings.update(changes)
    if (changes.theme) {
      applyTheme(changes.theme)
      await installMenu(services)
    }
    return next
  })
  const windowOf = (senderId: number) =>
    BrowserWindow.getAllWindows().find((window) => window.webContents.id === senderId)

  router.invoke('binary.saveToFile', async ({ bytes, suggestedName }, { sender }) => {
    const parent = windowOf(sender.id)
    const options = { title: 'Save value to a file', defaultPath: suggestedName }
    const choice = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (choice.canceled || !choice.filePath) {
      return false
    }
    await writeValueFile(choice.filePath, bytes)
    return true
  })

  router.invoke('binary.readFromFile', async (_request, { sender }) => {
    const parent = windowOf(sender.id)
    const options = { title: 'Choose a file', properties: ['openFile' as const] }
    const choice = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    const path = choice.filePaths[0]
    if (choice.canceled || !path) {
      return null
    }
    return readValueFile(path)
  })

  // The renderer has no clipboard permission (all permission requests are denied above).
  router.invoke('clipboard.writeText', async ({ text }) => {
    clipboard.writeText(text)
    return null
  })
  // File dialogs belong to main, so the renderer never handles file paths (design §3).
  router.invoke('profiles.importCaCertificate', async (_request, { sender }) => {
    const parent = BrowserWindow.getAllWindows().find((window) => window.webContents.id === sender.id)
    const options = {
      title: 'Add a trusted CA certificate',
      properties: ['openFile' as const],
      filters: [
        { name: 'Certificates', extensions: ['pem', 'crt', 'cer', 'der'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    const choice = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    const path = choice.filePaths[0]
    if (choice.canceled || !path) {
      return null
    }
    return importCaCertificate(new Uint8Array(await readFile(path)))
  })
  applyTheme((await services.settings.get().catch(() => undefined))?.theme ?? 'system')
  await installMenu(services)

  void createMainWindow(services)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(services)
    }
  })
  app.on('before-quit', () => {
    void services.disconnectAll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
