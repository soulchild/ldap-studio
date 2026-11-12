import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { Attribute, Change, Client } from 'ldapts'
import { launchApp, relaunch, type LaunchedApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

let launched: LaunchedApp
let page: Page
let admin: Client
let container: string
let entryDn: string

test.beforeEach(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  admin = new Client({ url: `ldap://${OPENLDAP.host}:${OPENLDAP.port}` })
  await admin.bind(OPENLDAP.adminDn, OPENLDAP.adminPassword)
  container = `ou=e2e-${randomUUID().slice(0, 8)},dc=example,dc=com`
  entryDn = `cn=Test Person,${container}`
  await admin.add(container, {
    objectClass: ['top', 'organizationalUnit'],
    ou: container.slice(3, container.indexOf(',')),
  })
  await admin.add(entryDn, {
    objectClass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'],
    cn: 'Test Person',
    sn: 'Person',
    mail: ['a@example.com', 'b@example.com'],
    telephoneNumber: '+1 555 0100',
  })
  await admin.add(`cn=Other,${container}`, { objectClass: ['top', 'person'], cn: 'Other', sn: 'Other' })

  launched = await launchApp()
  page = launched.window
  await page.evaluate(async (server) => {
    await window.api.invoke('profiles.save', {
      name: 'Test',
      host: server.host,
      port: server.port,
      security: 'none',
      bindDn: server.adminDn,
      baseDn: '',
      caCertificates: [],
      password: { action: 'set', value: server.adminPassword },
    })
  }, OPENLDAP)
  launched = await relaunch(launched)
  page = launched.window
  await page.getByRole('listitem', { name: 'Test' }).getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('listitem', { name: 'Test' })).toHaveAttribute('data-status', 'connected')
})

test.afterEach(async () => {
  await launched?.close()
  for (const dn of [`cn=Other,${container}`, entryDn, container]) {
    await admin?.del(dn).catch(() => undefined)
  }
  await admin?.unbind()
})

const editor = () => page.getByRole('region', { name: 'Entry' })
const attribute = (name: string): Locator => editor().getByRole('rowgroup', { name, exact: true })
const valueInputs = (name: string) => attribute(name).getByLabel(`${name} value`, { exact: true })

async function open(dn: string): Promise<void> {
  await page.getByLabel('Go to DN').fill(dn)
  await page.getByLabel('Go to DN').press('Enter')
  await expect(editor().getByRole('navigation', { name: 'Entry path' })).toBeVisible()
}

async function serverValues(name: string): Promise<string[]> {
  const { searchEntries } = await admin.search(entryDn, { scope: 'base', attributes: [name] })
  return [searchEntries[0]?.[name] ?? []].flat().map(String)
}

test.describe('viewing an entry (task 10.1)', () => {
  test('shows the DN path, one row per value and the required attributes', async () => {
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    const path = editor().getByRole('navigation', { name: 'Entry path' })
    await expect(path).toContainText('dc=example,dc=com')
    await expect(path).toContainText('ou=people')
    await expect(editor().getByRole('heading', { name: 'jdoe' })).toBeVisible()
    await expect(attribute('cn')).toContainText('required')
    await expect(attribute('sn')).toContainText('required')
    await expect(attribute('mail')).not.toContainText('required')
    await expect(valueInputs('telephoneNumber')).toHaveCount(2)
  })

  test('shows operational attributes on request, read-only', async () => {
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    await expect(attribute('createTimestamp')).toHaveCount(0)
    await editor().getByLabel('Show operational attributes').check()
    await expect(attribute('createTimestamp')).toContainText('read-only')
    await expect(valueInputs('createTimestamp')).toHaveCount(0)
  })

  test('opens an ancestor from the DN path', async () => {
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    await editor()
      .getByRole('navigation', { name: 'Entry path' })
      .getByRole('button', { name: 'ou=people' })
      .click()
    await expect(editor().getByRole('heading', { name: 'people' })).toBeVisible()
  })
})

test.describe('editing values (task 10.2)', () => {
  test('changes, adds and removes values, marks them pending, and discards', async () => {
    await open(entryDn)
    await valueInputs('mail').first().fill('changed@example.com')
    await attribute('mail').hover()
    await attribute('mail').getByRole('button', { name: 'Add mail value' }).click()
    await expect(valueInputs('mail').last()).toBeFocused()
    await valueInputs('mail').last().fill('c@example.com')
    await attribute('telephoneNumber').hover()
    await attribute('telephoneNumber').getByRole('button', { name: 'Remove telephoneNumber value' }).click()

    await expect(attribute('mail').getByRole('img', { name: 'Changed' })).toBeVisible()
    await expect(attribute('telephoneNumber')).toHaveCount(0)
    await expect(editor()).toContainText('2 unsaved changes')

    await editor().getByRole('button', { name: 'Discard' }).click()
    await expect(valueInputs('mail')).toHaveCount(2)
    await expect(valueInputs('mail').first()).toHaveValue('a@example.com')
    await expect(attribute('telephoneNumber')).toBeVisible()
    await expect(editor()).not.toContainText('unsaved')
  })

  test('suggests only attributes the object classes allow, and respects single values', async () => {
    await open(entryDn)
    await editor().getByRole('button', { name: 'Add attribute' }).click()
    const suggestions = await editor()
      .locator('#addable-attributes option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    expect(suggestions).toContain('displayName')
    expect(suggestions).toContain('title')
    expect(suggestions).not.toContain('uidNumber')
    expect(suggestions).not.toContain('mail')

    await editor().getByLabel('Attribute to add').fill('displayName')
    await editor().getByLabel('Attribute to add').press('Enter')
    await expect(valueInputs('displayName')).toBeFocused()
    await valueInputs('displayName').fill('Tester')
    await attribute('displayName').hover()
    await expect(attribute('displayName').getByRole('button', { name: 'Add displayName value' })).toHaveCount(
      0,
    )
  })
})

test.describe('saving (task 10.3)', () => {
  test('previews the changes and saves them as one modify', async () => {
    await open(entryDn)
    await valueInputs('sn').fill('Changed')
    await valueInputs('mail').first().fill('new@example.com')
    await editor().getByRole('button', { name: 'Review and save…' }).click()
    const preview = page.getByRole('dialog', { name: 'Review changes' })
    await expect(preview.getByRole('list', { name: 'Changes' })).toContainText('Replace')
    await expect(preview).toContainText('new@example.com')
    await preview.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(editor()).not.toContainText('unsaved')
    expect(await serverValues('sn')).toEqual(['Changed'])
    expect((await serverValues('mail')).sort()).toEqual(['b@example.com', 'new@example.com'])
  })

  test('blocks saving when a required attribute is removed', async () => {
    await open(entryDn)
    await attribute('sn').hover()
    await attribute('sn').getByRole('button', { name: 'Remove sn value' }).click()
    await editor().getByRole('button', { name: 'Review and save…' }).click()
    await expect(editor()).toContainText("sn is required by the entry's object classes.")
    await expect(editor()).toContainText('Fix 1 problem to save.')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await serverValues('sn')).toEqual(['Person'])
  })

  test('shows a server rejection and keeps the pending changes', async () => {
    await open(entryDn)
    // uidNumber is not allowed by inetOrgPerson, so the server refuses it.
    await editor().getByRole('button', { name: 'Add attribute' }).click()
    await editor().getByLabel('Attribute to add').fill('uidNumber')
    await editor().getByLabel('Attribute to add').press('Enter')
    await valueInputs('uidNumber').fill('1234')
    await editor().getByRole('button', { name: 'Review and save…' }).click()
    await page
      .getByRole('dialog', { name: 'Review changes' })
      .getByRole('button', { name: 'Save changes' })
      .click()
    await expect(editor().getByRole('alert')).toContainText('violates the schema')
    await expect(valueInputs('uidNumber')).toHaveValue('1234')
  })

  test('detects a concurrent change and reloads on request', async () => {
    await open(entryDn)
    await valueInputs('sn').fill('Mine')
    await admin.modify(
      entryDn,
      new Change({ operation: 'replace', modification: new Attribute({ type: 'sn', values: ['Theirs'] }) }),
    )
    await editor().getByRole('button', { name: 'Review and save…' }).click()
    await page
      .getByRole('dialog', { name: 'Review changes' })
      .getByRole('button', { name: 'Save changes' })
      .click()
    const stale = page.getByRole('dialog', { name: 'This entry was changed on the server' })
    await expect(stale).toBeVisible()
    expect(await serverValues('sn')).toEqual(['Theirs'])
    await stale.getByRole('button', { name: 'Reload' }).click()
    await expect(valueInputs('sn')).toHaveValue('Theirs')
    await expect(editor()).not.toContainText('unsaved')
  })
})

test.describe('leaving with unsaved changes (task 10.4)', () => {
  const tree = () => page.getByRole('tree', { name: 'Directory tree' })

  test('asks to save, discard or stay when another entry is selected', async () => {
    await open(entryDn)
    await valueInputs('sn').fill('Pending')
    await tree().getByRole('treeitem', { name: 'cn=Other' }).click()
    const guard = page.getByRole('dialog', { name: 'Save changes to Test Person?' })
    await expect(guard).toContainText('1 unsaved change')

    await guard.getByRole('button', { name: 'Stay' }).click()
    await expect(valueInputs('sn')).toHaveValue('Pending')
    await expect(tree().getByRole('treeitem', { name: 'cn=Test Person' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await tree().getByRole('treeitem', { name: 'cn=Other' }).click()
    await guard.getByRole('button', { name: 'Save' }).click()
    await expect(editor().getByRole('heading', { name: 'Other' })).toBeVisible()
    expect(await serverValues('sn')).toEqual(['Pending'])

    await tree().getByRole('treeitem', { name: 'cn=Test Person' }).click()
    await valueInputs('sn').fill('Thrown away')
    await tree().getByRole('treeitem', { name: 'cn=Other' }).click()
    await guard.getByRole('button', { name: 'Discard' }).click()
    await expect(editor().getByRole('heading', { name: 'Other' })).toBeVisible()
    expect(await serverValues('sn')).toEqual(['Pending'])
  })

  test('copies a value and all values of an attribute', async () => {
    const readClipboard = () => launched.app.evaluate(({ clipboard }) => clipboard.readText())
    await open(entryDn)
    await valueInputs('sn').hover()
    await attribute('sn').getByRole('button', { name: 'Copy sn value' }).click()
    await expect.poll(readClipboard).toBe('Person')
    await attribute('mail').hover()
    await attribute('mail').getByRole('button', { name: 'Copy all mail values' }).click()
    await expect.poll(readClipboard).toBe('a@example.com\nb@example.com')
  })
})
