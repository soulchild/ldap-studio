/**
 * The main workflow end to end, the way a user does it (task 14.2): create a profile, connect,
 * expand the tree, edit and save an entry, search for it, and switch the theme.
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { Client } from 'ldapts'
import { launchApp, type LaunchedApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

let launched: LaunchedApp | undefined
let admin: Client
let name: string

test.beforeEach(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  admin = new Client({ url: `ldap://${OPENLDAP.host}:${OPENLDAP.port}` })
  await admin.bind(OPENLDAP.adminDn, OPENLDAP.adminPassword)
  name = `smoke-${randomUUID().slice(0, 8)}`
  await admin.add(`ou=${name},dc=example,dc=com`, { objectClass: ['top', 'organizationalUnit'], ou: name })
  await admin.add(`cn=Smoke,ou=${name},dc=example,dc=com`, {
    objectClass: ['top', 'person'],
    cn: 'Smoke',
    sn: 'Before',
  })
})

test.afterEach(async () => {
  await launched?.close()
  await admin?.del(`cn=Smoke,ou=${name},dc=example,dc=com`).catch(() => undefined)
  await admin?.del(`ou=${name},dc=example,dc=com`).catch(() => undefined)
  await admin?.unbind()
})

test('create a profile, connect, browse, edit, search, and switch the theme', async () => {
  launched = await launchApp()
  const { app, window: page } = launched
  const entryDn = `cn=Smoke,ou=${name},dc=example,dc=com`

  // Create a profile.
  await page.getByRole('button', { name: 'New connection' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Smoke test')
  await dialog.getByLabel('Host').fill(OPENLDAP.host)
  await dialog.getByRole('radio', { name: 'None' }).click()
  await dialog.getByLabel('Port').fill(String(OPENLDAP.port))
  await dialog.getByLabel('Bind DN').fill(OPENLDAP.adminDn)
  await dialog.getByLabel('Password', { exact: true }).fill(OPENLDAP.adminPassword)
  await dialog.getByRole('button', { name: 'Create connection' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Connect.
  const profile = page.getByRole('listitem', { name: 'Smoke test', exact: true })
  await profile.getByRole('button', { name: 'Connect' }).click()
  await expect(profile).toHaveAttribute('data-status', 'connected')

  // Expand the tree down to the entry and open it.
  const tree = page.getByRole('tree', { name: 'Directory tree' })
  await tree.getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
  await tree.getByRole('button', { name: `Expand ou=${name}` }).click()
  await tree.getByRole('treeitem', { name: 'cn=Smoke', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Entry' })
  await expect(editor.getByRole('heading', { name: 'Smoke' })).toBeVisible()

  // Edit and save.
  await editor
    .getByRole('rowgroup', { name: 'sn', exact: true })
    .getByLabel('sn value', { exact: true })
    .fill('After')
  await editor.getByRole('button', { name: 'Review and save…' }).click()
  await page
    .getByRole('dialog', { name: 'Review changes' })
    .getByRole('button', { name: 'Save changes' })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Review and save…' })).toHaveCount(0)
  const { searchEntries } = await admin.search(entryDn, { scope: 'base', attributes: ['sn'] })
  expect(searchEntries[0]?.['sn']).toBe('After')

  // Search for the saved value.
  await page.getByRole('button', { name: 'Search', exact: true }).first().click()
  await page.getByLabel('Base DN').fill('dc=example,dc=com')
  await page.getByLabel('Filter', { exact: true }).click()
  await page.keyboard.type('(sn=After)')
  await page.keyboard.press('Escape')
  await page.getByRole('form', { name: 'Search' }).getByRole('button', { name: 'Search' }).click()
  await expect(
    page.getByRole('table', { name: 'Search results' }).getByRole('row', { name: entryDn }),
  ).toBeVisible()

  // Switch the theme from the View menu, both ways.
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
  const choose = (id: string) =>
    app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id)
  await choose('theme-dark')
  await expect.poll(isDark).toBe(true)
  await choose('theme-light')
  await expect.poll(isDark).toBe(false)
})
