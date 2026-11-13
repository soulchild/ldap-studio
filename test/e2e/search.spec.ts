import { expect, test, type Page } from '@playwright/test'
import { launchApp, relaunch, type LaunchedApp } from './app'
import { OPENLDAP, READER, testServersRunning } from './ldap-env'

let launched: LaunchedApp
let page: Page

async function launch(dataDirectory?: string): Promise<void> {
  launched = await launchApp(dataDirectory ? { dataDirectory } : {})
  page = launched.window
}

async function connect(): Promise<void> {
  const row = page.getByRole('listitem', { name: 'Reader' })
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-status', 'connected')
}

test.beforeEach(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  await launch()
  // The reader is subject to the server's size limit of 100 entries, unlike the admin.
  await page.evaluate(
    async ({ server, reader }) => {
      await window.api.invoke('profiles.save', {
        name: 'Reader',
        host: server.host,
        port: server.port,
        security: 'none',
        bindDn: reader.dn,
        baseDn: '',
        caCertificates: [],
        password: { action: 'set', value: reader.password },
      })
    },
    { server: OPENLDAP, reader: READER },
  )
  launched = await relaunch(launched)
  page = launched.window
  await connect()
})

test.afterEach(async () => {
  await launched?.close()
})

const tree = () => page.getByRole('tree', { name: 'Directory tree' })
const item = (name: string) => tree().getByRole('treeitem', { name, exact: true })
const filter = () => page.getByLabel('Filter', { exact: true })
const results = () => page.getByRole('table', { name: 'Search results' })
const status = () => page.getByRole('form', { name: 'Search' }).locator('..').getByRole('status')

async function typeFilter(text: string): Promise<void> {
  await filter().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}

async function setSearch(options: {
  base?: string
  scope?: string
  filter: string
  attributes?: string
  limit?: string
}) {
  await page.keyboard.press('ControlOrMeta+f')
  if (options.base !== undefined) {
    await page.getByLabel('Base DN').fill(options.base)
  }
  if (options.scope) {
    await page.getByLabel('Scope').selectOption({ label: options.scope })
  }
  if (options.attributes !== undefined) {
    await page.getByLabel('Attributes to return').click()
    await page.keyboard.type(options.attributes)
    await page.keyboard.press('Escape')
  }
  if (options.limit !== undefined) {
    await page.getByLabel('Size limit').fill(options.limit)
  }
  await typeFilter(options.filter)
}

const runSearch = () =>
  page.getByRole('form', { name: 'Search' }).getByRole('button', { name: 'Search' }).click()

test.describe('search form (task 13.1)', () => {
  test('defaults the base to the selected entry and the scope to subtree', async () => {
    await tree().getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
    await item('ou=people').click()
    await page.keyboard.press('ControlOrMeta+f')
    await expect(page.getByLabel('Base DN')).toHaveValue('ou=people,dc=example,dc=com')
    await expect(page.getByLabel('Scope')).toHaveValue('sub')
    await expect(filter()).toBeFocused()
  })

  test('chooses the base DN from the directory', async () => {
    await page.keyboard.press('ControlOrMeta+f')
    await page.getByRole('button', { name: 'Browse…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose base DN' })
    await dialog
      .getByRole('tree', { name: 'Entries to choose from' })
      .getByRole('treeitem', { name: 'ou=groups', exact: true })
      .dblclick()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel('Base DN')).toHaveValue('ou=groups,dc=example,dc=com')
  })

  test('marks a syntax error and blocks the search; warns about unknown attributes', async () => {
    await setSearch({ filter: '(&(uid=jdoe)(mail=*)' })
    await expect(page.getByRole('form', { name: 'Search' }).getByRole('alert')).toContainText('Missing ")"')
    await expect(
      page.getByRole('form', { name: 'Search' }).getByRole('button', { name: 'Search' }),
    ).toBeDisabled()

    await typeFilter('(shoeSize=42)')
    await expect(page.getByRole('form', { name: 'Search' }).getByRole('status')).toContainText(
      "shoeSize is not in the server's schema.",
    )
    await expect(
      page.getByRole('form', { name: 'Search' }).getByRole('button', { name: 'Search' }),
    ).toBeEnabled()
  })

  test('suggests attributes and object classes while typing', async () => {
    await page.keyboard.press('ControlOrMeta+f')
    await filter().click()
    await page.keyboard.type('(mai')
    await expect(page.getByRole('option', { name: 'mail', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('(objectClass=inetOrg')
    await expect(page.getByRole('option', { name: 'inetOrgPerson' })).toBeVisible()
  })
})

test.describe('results (task 13.2)', () => {
  test('lists 5,000 results past the server size limit with the requested columns', async () => {
    await setSearch({
      base: 'ou=bulk,dc=example,dc=com',
      scope: 'One level',
      filter: '(objectClass=*)',
      attributes: 'cn, sn',
      limit: '10000',
    })
    await runSearch()
    await expect(status()).toHaveText('5,000 results')
    await expect(results().getByRole('columnheader')).toHaveText(['DN', 'cn', 'sn'])
    await expect(
      results().getByRole('row', { name: 'cn=user00001,ou=bulk,dc=example,dc=com' }),
    ).toContainText('Bulk 00001')
  })

  test('stops at the size limit and says so', async () => {
    await setSearch({ base: 'ou=bulk,dc=example,dc=com', filter: '(cn=*)', limit: '1234' })
    await runSearch()
    await expect(status()).toHaveText('1,234 results. The search stopped at the size limit of 1,234.')
  })

  test('describes binary values instead of showing bytes', async () => {
    await setSearch({ base: 'dc=example,dc=com', filter: '(uid=jdoe)', attributes: 'cn, jpegPhoto' })
    await runSearch()
    await expect(results().getByRole('row', { name: /^uid=jdoe/ })).toContainText('JPEG image, 2.3 KB')
  })

  test('sorts by a column, ascending and descending', async () => {
    await setSearch({ base: 'ou=people,dc=example,dc=com', filter: '(uid=*)', attributes: 'uid' })
    await runSearch()
    await expect(status()).toHaveText('6 results')
    await results().getByRole('columnheader', { name: 'uid' }).click()
    await expect(results().getByRole('row').nth(1)).toContainText('asmith')
    await results().getByRole('columnheader', { name: 'uid' }).click()
    await expect(results().getByRole('row').nth(1)).toContainText('reader')
  })

  test('reports a missing base', async () => {
    await setSearch({ base: 'ou=missing,dc=example,dc=com', filter: '(objectClass=*)' })
    await runSearch()
    await expect(page.getByRole('alert').filter({ hasText: 'No such entry exists.' })).toBeVisible()
  })

  test('opens a result in the editor and the tree', async () => {
    await setSearch({ base: 'dc=example,dc=com', filter: '(uid=jdoe)' })
    await runSearch()
    await results()
      .getByRole('row', { name: /^uid=jdoe/ })
      .click()
    await expect(
      page.getByRole('region', { name: 'Entry' }).getByRole('heading', { name: 'jdoe' }),
    ).toBeVisible()
    await expect(item('uid=jdoe')).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('recent searches (task 13.3)', () => {
  test('remembers searches across restarts, once each, and fills the form from one', async () => {
    await setSearch({ base: 'ou=people,dc=example,dc=com', filter: '(uid=jdoe)' })
    await runSearch()
    await expect(status()).toHaveText('1 result')
    await runSearch()
    await expect(status()).toHaveText('1 result')
    await typeFilter('(uid=asmith)')
    await runSearch()
    await expect(status()).toHaveText('1 result')

    launched = await relaunch(launched)
    page = launched.window
    await connect()
    await page.keyboard.press('ControlOrMeta+f')
    await page.getByRole('button', { name: 'Recent' }).click()
    const items = page.getByRole('menuitem')
    await expect(items).toHaveText([
      '(uid=asmith) in ou=people,dc=example,dc=com',
      '(uid=jdoe) in ou=people,dc=example,dc=com',
    ])
    await items.nth(1).click()
    await expect(filter()).toHaveText('(uid=jdoe)')
    await expect(page.getByLabel('Base DN')).toHaveValue('ou=people,dc=example,dc=com')
  })
})
