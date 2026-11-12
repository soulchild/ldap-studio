/**
 * A slow server must not block the interface (app-shell spec), and a cancelled search keeps the
 * results so far (directory-search spec). The server is slowed down by a proxy in front of it.
 */
import { expect, test, type Page } from '@playwright/test'
import { startTcpProxy, type TcpProxy } from '../integration/tcp-proxy'
import { launchApp, relaunch, type LaunchedApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

let launched: LaunchedApp
let page: Page
let proxy: TcpProxy

test.beforeEach(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  proxy = await startTcpProxy(OPENLDAP.host, OPENLDAP.port)
  launched = await launchApp()
  page = launched.window
  await page.evaluate(
    async ({ server, port }) => {
      await window.api.invoke('profiles.save', {
        name: 'Slow',
        host: '127.0.0.1',
        port,
        security: 'none',
        bindDn: server.adminDn,
        baseDn: '',
        caCertificates: [],
        password: { action: 'set', value: server.adminPassword },
      })
    },
    { server: OPENLDAP, port: proxy.port },
  )
  launched = await relaunch(launched)
  page = launched.window
  const row = page.getByRole('listitem', { name: 'Slow' })
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-status', 'connected')
})

test.afterEach(async () => {
  await launched?.close()
  await proxy?.close()
})

test('a slow search leaves the tree and editor usable, and Stop keeps the results so far', async () => {
  const tree = page.getByRole('tree', { name: 'Directory tree' })
  await tree.getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
  await tree.getByRole('button', { name: 'Expand ou=people' }).click()
  await tree.getByRole('treeitem', { name: 'uid=asmith', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Entry' })
  await expect(editor.getByRole('heading', { name: 'asmith' })).toBeVisible()

  // From here on the server sends 40 KB/s: a page of 500 entries takes a few seconds, all
  // 5,000 far longer than this test.
  proxy.throttle(40_000)
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByLabel('Base DN').fill('ou=bulk,dc=example,dc=com')
  await page.getByLabel('Size limit').fill('10000')
  await page.getByLabel('Filter', { exact: true }).click()
  await page.keyboard.type('(objectClass=*)')
  await page.keyboard.press('Escape')
  await page.getByRole('form', { name: 'Search' }).getByRole('button', { name: 'Search' }).click()
  const status = page.getByRole('form', { name: 'Search' }).locator('..').getByRole('status')
  await expect(status).toContainText(/Searching… [1-9]/, { timeout: 15_000 })

  // While it runs, the tree moves with the keyboard and opens another loaded entry.
  await tree.getByRole('treeitem', { name: 'uid=asmith', exact: true }).click()
  await page.keyboard.press('ArrowDown')
  await expect(tree.getByRole('treeitem', { name: 'uid=bwayne', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(editor.getByRole('heading', { name: 'bwayne' })).toBeVisible()
  await expect(status).toContainText('Searching…')

  // Stop: the results so far stay, and no more arrive.
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(status).toContainText(/^Stopped\. [\d,]+ results?$/)
  const stopped = await status.textContent()
  const rows = page.getByRole('table', { name: 'Search results' }).getByRole('row')
  expect(await rows.count()).toBeGreaterThan(1)
  await page.waitForTimeout(1_000)
  await expect(status).toHaveText(stopped ?? '')
  expect(stopped).not.toContain('5,000')
})
