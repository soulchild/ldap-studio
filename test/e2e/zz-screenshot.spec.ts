/** Development helper: `SCREENSHOTS=1 pnpm exec playwright test zz-screenshot` writes screenshots to scratchpad/. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { launchApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to capture screenshots')

test('screenshot', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'ldap-studio-shots-'))
  let launched = await launchApp({ dataDirectory })
  let page = launched.window
  await page.setViewportSize({ width: 1280, height: 800 })
  if (await testServersRunning()) {
    await page.evaluate(async (server) => {
      const profile = (
        name: string,
        port: number,
        security: 'none' | 'ldaps' | 'starttls',
        password?: string,
      ) =>
        window.api.invoke('profiles.save', {
          name,
          host: name === 'Staging' ? 'ldap-staging.example.com' : server.host,
          port,
          security,
          bindDn: server.adminDn,
          baseDn: '',
          caCertificates: [],
          password: password ? { action: 'set', value: password } : { action: 'keep' },
        })
      await profile('Test OpenLDAP', server.port, 'none', server.adminPassword)
      await profile('Production', 636, 'ldaps')
      await profile('Staging', 389, 'starttls')
    }, OPENLDAP)
    // Restart so the app loads the new profiles; reloading the page counts as navigation, which is blocked.
    await launched.close()
    launched = await launchApp({ dataDirectory })
    page = launched.window
    await page.setViewportSize({ width: 1280, height: 800 })
    const row = page.getByRole('listitem', { name: 'Test OpenLDAP' })
    await row.getByRole('button', { name: 'Connect' }).click()
    await page.waitForSelector('[data-status="connected"]')
    const tree = page.getByRole('tree', { name: 'Directory tree' })
    await tree.getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
    await tree.getByRole('button', { name: 'Expand ou=people' }).click()
    // Select first: rows far below the visible area are not rendered (virtualized).
    await tree.getByRole('treeitem', { name: 'uid=jdoe' }).click()
    await page.waitForTimeout(1500)
  }
  if (await testServersRunning()) {
    await page.getByRole('button', { name: 'Search', exact: true }).first().click()
    await page.getByLabel('Base DN').fill('dc=example,dc=com')
    await page.getByLabel('Attributes to return').click()
    await page.keyboard.type('cn, mail, uidNumber')
    await page.getByLabel('Filter', { exact: true }).click()
    await page.keyboard.type('(&(objectClass=inetOrgPerson)(uid=*))')
    await page.keyboard.press('Escape')
    await page.getByRole('form', { name: 'Search' }).getByRole('button', { name: 'Search' }).click()
    await page.waitForTimeout(500)
  }
  // Show the binary values at the end of jdoe's attributes.
  await page.evaluate(() => {
    const table = document.querySelector('[aria-label="Attributes"]')?.parentElement
    if (table) {
      table.scrollTop = table.scrollHeight
    }
  })
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((mode) => window.api.invoke('settings.update', { theme: mode }), theme)
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains('dark') === dark,
      theme === 'dark',
    )
    await page.waitForTimeout(300)
    await page.screenshot({ path: `scratchpad/shell-${theme}.png` })
  }
  await page.keyboard.press('ControlOrMeta+/')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'scratchpad/shortcuts-dark.png' })
  await page.keyboard.press('Escape')
  if (await testServersRunning()) {
    await page.getByRole('treeitem', { name: 'ou=people' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'New entry…' }).click()
    const create = page.getByRole('dialog', { name: 'New entry' })
    await create.getByLabel('Find object classes').fill('person')
    await create.getByRole('checkbox', { name: /^inetOrgPerson/ }).check()
    await create.getByLabel('Name', { exact: true }).fill('Jane Doe')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'scratchpad/create-dark.png' })
    await create.getByRole('button', { name: 'Cancel' }).click()
  }
  await page.getByRole('button', { name: 'New connection' }).first().click()
  await page.getByRole('dialog').getByLabel('Bind DN').fill('cn=admin,dc=example,dc=com')
  await page.getByRole('dialog').getByRole('radio', { name: 'None' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'scratchpad/editor-dark.png' })
  await launched.close()
  rmSync(dataDirectory, { recursive: true, force: true })
})
