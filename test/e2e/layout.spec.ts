import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './app'

const width = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((element) => Math.round(element.getBoundingClientRect().width))
const height = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((element) => Math.round(element.getBoundingClientRect().height))

let dataDirectory: string

test.beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), 'ldap-studio-layout-'))
})

test.afterEach(() => {
  rmSync(dataDirectory, { recursive: true, force: true })
})

test('shows the directory above the connections, the editor and the bottom panel', async () => {
  const launched = await launchApp({ dataDirectory })
  const { window } = launched
  const directory = await window.getByRole('region', { name: 'Directory' }).boundingBox()
  const connections = await window.getByRole('region', { name: 'Connections' }).boundingBox()
  const editor = await window.getByRole('region', { name: 'Entry' }).boundingBox()
  const bottom = await window.getByRole('region', { name: 'Search and log' }).boundingBox()
  expect(directory!.y).toBeLessThan(connections!.y)
  expect(directory!.x).toBeLessThan(editor!.x)
  expect(editor!.y).toBeLessThan(bottom!.y)
  // Nothing to search before connecting: a hint instead of the form.
  await expect(window.getByRole('form', { name: 'Search' })).toHaveCount(0)
  await expect(window.getByRole('region', { name: 'Search and log' })).toContainText(
    'Connect to a server to search its directory.',
  )
  await launched.close()
})

test('pane sizes, the collapsed bottom panel and the window bounds persist across relaunch', async () => {
  let launched = await launchApp({ dataDirectory })
  let window = launched.window
  const sidebarBefore = await width(window, 'sidebar')

  // Drag the divider between the sidebar and the main area 120 px to the right.
  const sidebar = (await window.getByTestId('sidebar').boundingBox())!
  await window.mouse.move(sidebar.x + sidebar.width + 3, sidebar.y + 200)
  await window.mouse.down()
  await window.mouse.move(sidebar.x + sidebar.width + 3 + 120, sidebar.y + 200, { steps: 8 })
  await window.mouse.up()
  const sidebarAfter = await width(window, 'sidebar')
  expect(Math.abs(sidebarAfter - (sidebarBefore + 120))).toBeLessThanOrEqual(2)

  await window.getByRole('button', { name: 'Collapse panel' }).click()
  await expect(window.getByRole('button', { name: 'Expand panel' })).toBeVisible()

  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 120, y: 90, width: 1100, height: 720 })
  })
  await window.waitForTimeout(800)
  await launched.close()

  launched = await launchApp({ dataDirectory })
  window = launched.window
  await expect(window.getByRole('button', { name: 'Expand panel' })).toBeVisible()
  expect(Math.abs((await width(window, 'sidebar')) - sidebarAfter)).toBeLessThanOrEqual(2)
  // Still collapsed to its tab bar (36 px plus the pane's 2 px of border), and the editor fills
  // the rest of the main area beside the 6 px gap.
  expect(Math.abs((await height(window, 'bottom')) - 38)).toBeLessThanOrEqual(1)
  const content = await height(window, 'content-layout')
  expect(Math.abs((await height(window, 'editor')) + 38 + 6 - content)).toBeLessThanOrEqual(2)
  const bounds = await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getBounds(),
  )
  expect(bounds).toMatchObject({ x: 120, y: 90, width: 1100, height: 720 })
  await launched.close()
})

test('collapsing the bottom panel gives its space to the editor, and a tab click restores it', async () => {
  const launched = await launchApp({ dataDirectory })
  const { window } = launched
  const editorBefore = await height(window, 'editor')
  await window.getByRole('button', { name: 'Collapse panel' }).click()
  expect(await height(window, 'editor')).toBeGreaterThan(editorBefore + 50)
  await window.getByRole('tab', { name: 'Log' }).click()
  await expect(window.getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true')
  expect(Math.abs((await height(window, 'editor')) - editorBefore)).toBeLessThanOrEqual(2)
  await launched.close()
})
