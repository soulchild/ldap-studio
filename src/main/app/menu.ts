/** The application menu: standard edit commands (needed for copy and paste) and the theme choice. */
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { AppServices } from './services'
import { applyTheme, type ThemeMode } from './theme'

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'Match system' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
]

export async function installMenu(services: AppServices): Promise<void> {
  const settings = await services.settings.get()
  const setTheme = async (mode: ThemeMode) => {
    applyTheme(mode)
    await services.settings.update({ theme: mode })
    await installMenu(services)
  }

  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : [{ role: 'fileMenu' as const }]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Theme',
          submenu: THEMES.map(({ mode, label }) => ({
            id: `theme-${mode}`,
            label,
            type: 'radio' as const,
            checked: settings.theme === mode,
            click: () => void setTheme(mode),
          })),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(app.isPackaged
          ? []
          : [
              { type: 'separator' as const },
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const },
            ]),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    // macOS has About in the app menu; elsewhere it goes in Help.
    ...(isMac
      ? []
      : [{ role: 'help' as const, submenu: [{ role: 'about' as const, label: 'About LDAP Studio' }] }]),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
