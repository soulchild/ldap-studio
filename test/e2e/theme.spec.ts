import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './app'

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'))
const clickMenu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id)
const themeSource = (app: ElectronApplication) => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)

let dataDirectory: string

test.beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), 'ldap-studio-theme-'))
})

test.afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true })
})

test('choosing a theme in the menu switches the window and native UI, and persists', async () => {
  let launched = await launchApp({ dataDirectory })
  expect(await themeSource(launched.app)).toBe('system')

  await clickMenu(launched.app, 'theme-dark')
  await expect.poll(() => isDark(launched.window)).toBe(true)
  expect(await themeSource(launched.app)).toBe('dark')

  await clickMenu(launched.app, 'theme-light')
  await expect.poll(() => isDark(launched.window)).toBe(false)

  await clickMenu(launched.app, 'theme-dark')
  await expect.poll(() => isDark(launched.window)).toBe(true)
  await launched.close()

  launched = await launchApp({ dataDirectory })
  expect(await isDark(launched.window)).toBe(true)
  expect(await themeSource(launched.app)).toBe('dark')
  const checked = await launched.app.evaluate(
    ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('theme-dark')?.checked,
  )
  expect(checked).toBe(true)
  await launched.close()
})

test('a theme chosen through settings.update applies too', async () => {
  const launched = await launchApp({ dataDirectory })
  await launched.window.evaluate(() => window.api.invoke('settings.update', { theme: 'dark' }))
  await expect.poll(() => isDark(launched.window)).toBe(true)
  await launched.close()
})

test('in "match system" mode the window follows the OS appearance live', async () => {
  const launched = await launchApp({ dataDirectory })
  await launched.window.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => isDark(launched.window)).toBe(true)
  await launched.window.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => isDark(launched.window)).toBe(false)
  await launched.close()
})
