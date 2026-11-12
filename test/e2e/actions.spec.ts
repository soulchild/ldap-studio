import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { Client } from 'ldapts'
import { launchApp, relaunch, type LaunchedApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

const DELETER = { dn: 'uid=deleter,ou=people,dc=example,dc=com', password: 'deleter-test-pw' }

let launched: LaunchedApp
let page: Page
let admin: Client
let container: string
let containerName: string

const person = (cn: string, extra: Record<string, string | string[]> = {}) => ({
  objectClass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'],
  cn,
  sn: 'Tester',
  ...extra,
})

/** Test cleanup: deletes the container deepest-first. */
async function removeContainer(): Promise<void> {
  const { searchEntries } = await admin
    .search(container, { scope: 'sub', attributes: ['1.1'] })
    .catch(() => ({
      searchEntries: [],
    }))
  const dns = searchEntries.map((entry) => entry.dn).sort((a, b) => b.split(',').length - a.split(',').length)
  for (const dn of dns) {
    await admin.del(dn).catch(() => undefined)
  }
}

async function exists(dn: string): Promise<boolean> {
  try {
    const { searchEntries } = await admin.search(dn, { scope: 'base', attributes: ['1.1'] })
    return searchEntries.length === 1
  } catch {
    return false
  }
}

async function values(dn: string, attribute: string): Promise<string[]> {
  const { searchEntries } = await admin.search(dn, { scope: 'base', attributes: [attribute] })
  return [searchEntries[0]?.[attribute] ?? []].flat().map(String)
}

/** Launches the app with profiles saved, connects the first, and opens the test container in the tree. */
async function start(profiles: { name: string; dn: string; password: string }[]): Promise<void> {
  launched = await launchApp()
  page = launched.window
  for (const profile of profiles) {
    await page.evaluate(
      async ({ server, profile: p }) => {
        await window.api.invoke('profiles.save', {
          name: p.name,
          host: server.host,
          port: server.port,
          security: 'none',
          bindDn: p.dn,
          baseDn: '',
          caCertificates: [],
          password: { action: 'set', value: p.password },
        })
      },
      { server: OPENLDAP, profile },
    )
  }
  launched = await relaunch(launched)
  page = launched.window
  const row = page.getByRole('listitem', { name: profiles[0]!.name })
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-status', 'connected')
  await page.getByLabel('Go to DN').fill(container)
  await page.getByLabel('Go to DN').press('Enter')
  await expect(item(`ou=${containerName}`)).toHaveAttribute('aria-selected', 'true')
  // An empty container is a leaf and has nothing to expand.
  const expand = tree().getByRole('button', { name: `Expand ou=${containerName}` })
  if (await expand.count()) {
    await expand.click()
  }
}

const tree = () => page.getByRole('tree', { name: 'Directory tree' })
const item = (name: string) => tree().getByRole('treeitem', { name, exact: true })
const editor = () => page.getByRole('region', { name: 'Entry' })
const menu = async (name: string, action: string) => {
  await item(name).click({ button: 'right' })
  await page.getByRole('menuitem', { name: action }).click()
}

test.beforeEach(async () => {
  const testInfo = test.info()
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  admin = new Client({ url: `ldap://${OPENLDAP.host}:${OPENLDAP.port}` })
  await admin.bind(OPENLDAP.adminDn, OPENLDAP.adminPassword)
  // ou=it-* containers are where the test servers let uid=deleter delete (test/ldap/README.md).
  containerName = `${testInfo.title.includes('permission') ? 'it' : 'e2e'}-${randomUUID().slice(0, 8)}`
  container = `ou=${containerName},dc=example,dc=com`
  await admin.add(container, { objectClass: ['top', 'organizationalUnit'], ou: containerName })
})

test.afterEach(async () => {
  await launched?.close()
  await removeContainer()
  await admin?.unbind()
})

const adminProfile = { name: 'Admin', dn: OPENLDAP.adminDn, password: OPENLDAP.adminPassword }

test.describe('creating entries (task 11.1)', () => {
  test('creates a person: required attributes are listed and must be filled in', async () => {
    await start([adminProfile])
    await menu(`ou=${containerName}`, 'New entry…')
    const dialog = page.getByRole('dialog', { name: 'New entry' })
    await dialog.getByLabel('Find object classes').fill('inetorgperson')
    await dialog.getByRole('checkbox', { name: /^inetOrgPerson/ }).check()
    await expect(dialog.getByLabel('Named by')).toHaveValue('cn')
    await dialog.getByLabel('Name', { exact: true }).fill('Jane Doe')
    await expect(dialog).toContainText(`cn=Jane Doe,${container}`)
    await dialog.getByRole('button', { name: 'Continue' }).click()

    await expect(editor().getByRole('heading', { name: 'New entry' })).toBeVisible()
    await expect(editor().getByLabel('cn value', { exact: true })).toHaveValue('Jane Doe')
    await expect(editor().getByRole('rowgroup', { name: 'sn', exact: true })).toContainText('required')
    await expect(editor().getByLabel('sn value', { exact: true })).toHaveValue('')
    expect(await exists(`cn=Jane Doe,${container}`)).toBe(false)

    await editor().getByRole('button', { name: 'Create entry' }).click()
    await expect(editor()).toContainText("sn is required by the entry's object classes.")
    expect(await exists(`cn=Jane Doe,${container}`)).toBe(false)

    await editor().getByLabel('sn value', { exact: true }).fill('Doe')
    await editor().getByRole('button', { name: 'Create entry' }).click()
    await expect(editor().getByRole('heading', { name: 'Jane Doe' })).toBeVisible()
    expect(await values(`cn=Jane Doe,${container}`, 'objectClass')).toEqual(
      expect.arrayContaining(['top', 'person', 'organizationalPerson', 'inetOrgPerson']),
    )
    await expect(item('cn=Jane Doe')).toHaveAttribute('aria-selected', 'true')
  })

  test('requires a structural object class', async () => {
    await start([adminProfile])
    await menu(`ou=${containerName}`, 'New entry…')
    const dialog = page.getByRole('dialog', { name: 'New entry' })
    await dialog.getByLabel('Find object classes').fill('posixAccount')
    await dialog.getByRole('checkbox', { name: /^posixAccount/ }).check()
    await dialog.getByLabel('Name', { exact: true }).fill('x')
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await expect(dialog).toContainText('Choose a structural object class')
  })
})

test.describe('copying entries (task 11.2)', () => {
  test('copies the user attributes into a draft that is only created on save', async () => {
    await admin.add(`cn=Source,${container}`, person('Source', { mail: 'source@example.com' }))
    await start([adminProfile])
    await menu('cn=Source', 'Copy entry…')
    const dialog = page.getByRole('dialog', { name: 'Copy entry' })
    await dialog.getByLabel('New cn').fill('Target')
    await dialog.getByRole('button', { name: 'Continue' }).click()

    await expect(editor().getByRole('heading', { name: 'New entry' })).toBeVisible()
    await expect(editor().getByLabel('mail value', { exact: true })).toHaveValue('source@example.com')
    await expect(editor().getByLabel('cn value', { exact: true })).toHaveValue('Target')
    await expect(editor().getByRole('rowgroup', { name: 'createTimestamp' })).toHaveCount(0)
    expect(await exists(`cn=Target,${container}`)).toBe(false)

    await editor().getByRole('button', { name: 'Create entry' }).click()
    await expect(editor().getByRole('heading', { name: 'Target' })).toBeVisible()
    expect(await values(`cn=Target,${container}`, 'mail')).toEqual(['source@example.com'])
    expect(await values(`cn=Target,${container}`, 'cn')).toEqual(['Target'])
  })
})

test.describe('renaming and moving (task 11.3)', () => {
  test('renames an entry, removing or keeping the old name', async () => {
    await admin.add(`cn=Old,${container}`, person('Old'))
    await admin.add(`cn=Kept,${container}`, person('Kept'))
    await start([adminProfile])

    await menu('cn=Old', 'Rename…')
    const rename = page.getByRole('dialog', { name: 'Rename entry' })
    await rename.getByLabel('New name').fill('cn=New')
    await rename.getByRole('button', { name: 'Rename' }).click()
    await expect(item('cn=New')).toHaveAttribute('aria-selected', 'true')
    expect(await exists(`cn=Old,${container}`)).toBe(false)
    expect(await values(`cn=New,${container}`, 'cn')).toEqual(['New'])

    await menu('cn=Kept', 'Rename…')
    await rename.getByLabel('New name').fill('cn=Renamed')
    await rename.getByLabel('Keep “Kept” as a value of cn').check()
    await rename.getByRole('button', { name: 'Rename' }).click()
    await expect(item('cn=Renamed')).toBeVisible()
    expect((await values(`cn=Renamed,${container}`, 'cn')).sort()).toEqual(['Kept', 'Renamed'])
  })

  test('moves an entry by drag and drop after confirming the old and new DN', async () => {
    await admin.add(`ou=target,${container}`, { objectClass: ['top', 'organizationalUnit'], ou: 'target' })
    await admin.add(`cn=Mover,${container}`, person('Mover'))
    await start([adminProfile])

    // Playwright's mouse-driven drag does not reach Electron's HTML5 drag and drop, so send the
    // same events the browser would: dragstart on the entry, dragover and drop on the target.
    // Take the rows first: once the move dialog opens, the rest of the page is aria-hidden and
    // role-based locators no longer find them.
    const source = await item('cn=Mover').elementHandle()
    const target = await item('ou=target').elementHandle()
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await source!.dispatchEvent('dragstart', { dataTransfer })
    await target!.dispatchEvent('dragover', { dataTransfer })
    await target!.dispatchEvent('drop', { dataTransfer })
    await source!.dispatchEvent('dragend', { dataTransfer })
    const move = page.getByRole('dialog', { name: 'Move entry' })
    const change = move.getByRole('definition')
    await expect(change.first()).toHaveText(`cn=Mover,${container}`)
    await expect(change.last()).toHaveText(`cn=Mover,ou=target,${container}`)
    expect(await exists(`cn=Mover,${container}`)).toBe(true)
    await move.getByRole('button', { name: 'Move' }).click()

    await expect(item('cn=Mover')).toHaveAttribute('aria-selected', 'true')
    await expect(item('cn=Mover')).toHaveAttribute('aria-level', '4')
    expect(await exists(`cn=Mover,ou=target,${container}`)).toBe(true)
    expect(await exists(`cn=Mover,${container}`)).toBe(false)
  })

  test('shows a server refusal and leaves the tree unchanged', async () => {
    await admin.add(`cn=First,${container}`, person('First'))
    await admin.add(`cn=Second,${container}`, person('Second'))
    await start([adminProfile])
    await menu('cn=First', 'Rename…')
    const rename = page.getByRole('dialog', { name: 'Rename entry' })
    await rename.getByLabel('New name').fill('cn=Second')
    await rename.getByRole('button', { name: 'Rename' }).click()
    await expect(rename.getByRole('alert')).toContainText('An entry with this DN already exists.')
    await rename.getByRole('button', { name: 'Cancel' }).click()
    await expect(item('cn=First')).toBeVisible()
    await expect(item('cn=Second')).toBeVisible()
  })
})

test.describe('deleting (task 11.4)', () => {
  test('deletes a leaf entry after confirmation', async () => {
    await admin.add(`cn=Leaf,${container}`, person('Leaf'))
    await start([adminProfile])
    await menu('cn=Leaf', 'Delete…')
    const dialog = page.getByRole('dialog', { name: 'Delete cn=Leaf?' })
    await expect(dialog).toContainText('The entry is deleted. This cannot be undone.')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    // While the dialog is open the tree is aria-hidden; wait until deleting has closed it.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(item('cn=Leaf')).toHaveCount(0)
    expect(await exists(`cn=Leaf,${container}`)).toBe(false)
  })

  async function buildSubtree(base: string, extra?: () => Promise<void>): Promise<void> {
    await admin.add(base, { objectClass: ['top', 'organizationalUnit'], ou: 'temp' })
    for (let group = 1; group <= 4; group++) {
      const groupDn = `ou=g${group},${base}`
      await admin.add(groupDn, { objectClass: ['top', 'organizationalUnit'], ou: `g${group}` })
      for (let i = 1; i <= 29; i++) {
        await admin.add(`cn=p${i},${groupDn}`, person(`p${i}`))
      }
    }
    await extra?.()
  }

  test('deletes a subtree of 121 entries after stating the count', async () => {
    const temp = `ou=temp,${container}`
    await buildSubtree(temp)
    await start([adminProfile])
    await menu('ou=temp', 'Delete…')
    const dialog = page.getByRole('dialog', { name: 'Delete ou=temp?' })
    await expect(dialog).toContainText('121 entries will be deleted')
    await dialog.getByRole('button', { name: 'Delete 121 entries' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(item('ou=temp')).toHaveCount(0)
    expect(await exists(temp)).toBe(false)
  })

  test('reports how far a subtree delete got when permission is missing partway', async () => {
    const temp = `ou=temp,${container}`
    await buildSubtree(temp, () => admin.add(`cn=protected-entry,${temp}`, person('protected-entry')))
    await start([{ name: 'Deleter', dn: DELETER.dn, password: DELETER.password }])
    await menu('ou=temp', 'Delete…')
    const dialog = page.getByRole('dialog', { name: 'Delete ou=temp?' })
    await expect(dialog).toContainText('122 entries will be deleted')
    await dialog.getByRole('button', { name: 'Delete 122 entries' }).click()
    await expect(dialog.getByRole('alert')).toContainText(`cn=protected-entry,${temp} could not be deleted.`)
    await expect(dialog.getByRole('alert')).toContainText('You do not have permission to do this.')
    await expect(dialog).toContainText(/Deleted \d+ of 122 entries, then stopped./)
    expect(await exists(`cn=protected-entry,${temp}`)).toBe(true)
  })
})
