import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

const CA_FILE = resolve(__dirname, '../ldap/certs/ca.crt')
const LDAPS_PORT = 3636
const DS389 = { port: 4389, adminDn: 'cn=Directory Manager', adminPassword: 'admin-test-pw' }

let launched: LaunchedApp
let page: Page

test.beforeEach(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  launched = await launchApp()
  page = launched.window
})

test.afterEach(async () => {
  await launched?.close()
})

const row = (name: string): Locator => page.getByRole('listitem', { name, exact: true })
const editor = (): Locator => page.getByRole('dialog')

async function openNewConnection(): Promise<void> {
  await page.getByRole('button', { name: 'New connection' }).first().click()
  await expect(editor()).toContainText('New connection')
}

async function fillProfile(fields: {
  name: string
  host?: string
  port?: number
  encryption?: 'LDAPS' | 'StartTLS' | 'None'
  bindDn?: string
  password?: string
}): Promise<void> {
  const dialog = editor()
  await dialog.getByLabel('Name').fill(fields.name)
  await dialog.getByLabel('Host').fill(fields.host ?? 'localhost')
  if (fields.encryption) {
    await dialog.getByRole('radio', { name: fields.encryption }).click()
  }
  if (fields.port !== undefined) {
    await dialog.getByLabel('Port').fill(String(fields.port))
  }
  if (fields.bindDn !== undefined) {
    await dialog.getByLabel('Bind DN').fill(fields.bindDn)
  }
  if (fields.password !== undefined) {
    await dialog.getByLabel('Password', { exact: true }).fill(fields.password)
  }
}

async function createProfile(fields: Parameters<typeof fillProfile>[0]): Promise<void> {
  await openNewConnection()
  await fillProfile(fields)
  await editor().getByRole('button', { name: 'Create connection' }).click()
  await expect(row(fields.name)).toBeVisible()
}

/** The OS file dialog cannot be driven by tests; make it return the test CA. */
async function stubCaFileDialog(): Promise<void> {
  await launched.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, CA_FILE)
}

test.describe('connection editor (task 8.2)', () => {
  test('defaults the port to the encryption mode and warns about plain LDAP with a bind DN', async () => {
    await openNewConnection()
    const dialog = editor()
    await expect(dialog.getByLabel('Port')).toHaveValue('636')
    await dialog.getByRole('radio', { name: 'StartTLS' }).click()
    await expect(dialog.getByLabel('Port')).toHaveValue('389')
    await dialog.getByRole('radio', { name: 'None' }).click()
    await expect(dialog).not.toContainText('sent in plain text')
    await dialog.getByLabel('Bind DN').fill(OPENLDAP.adminDn)
    await expect(dialog).toContainText('Without encryption, the bind DN and password are sent in plain text.')
  })

  test('keeps a port the user typed when the encryption changes', async () => {
    await openNewConnection()
    await editor().getByLabel('Port').fill('1636')
    await editor().getByRole('radio', { name: 'StartTLS' }).click()
    await expect(editor().getByLabel('Port')).toHaveValue('1636')
  })

  test('validates required fields and DN syntax before saving', async () => {
    await openNewConnection()
    await editor().getByLabel('Bind DN').fill('not a dn')
    await editor().getByRole('button', { name: 'Create connection' }).click()
    await expect(editor()).toContainText('Enter a name for this connection.')
    await expect(editor()).toContainText('Enter the server host name or address.')
    await expect(editor()).toContainText('Enter a DN, or for Active Directory user@domain or DOMAIN\\user.')
    // Active Directory sign-in names are accepted as they are.
    for (const name of ['jdoe@example.com', 'EXAMPLE\\jdoe']) {
      await editor().getByLabel('Bind DN').fill(name)
      await expect(editor()).not.toContainText('Enter a DN, or for Active Directory')
    }
  })

  test('tests a connection: success, a refused port and a certificate host name mismatch', async () => {
    await stubCaFileDialog()
    await openNewConnection()
    await fillProfile({
      name: 'Test',
      encryption: 'StartTLS',
      port: OPENLDAP.port,
      bindDn: OPENLDAP.adminDn,
      password: OPENLDAP.adminPassword,
    })
    await editor().getByRole('button', { name: 'Add certificate…' }).click()
    await expect(editor().getByRole('list', { name: 'Trusted CA certificates' })).toContainText(
      'CN=LDAP Studio Test CA',
    )

    await editor().getByRole('button', { name: 'Test connection' }).click()
    await expect(editor().getByRole('status')).toContainText('Connected successfully.')
    await expect(editor().getByRole('status')).toContainText('dc=example,dc=com')

    await editor().getByLabel('Port').fill('1')
    await editor().getByRole('button', { name: 'Test connection' }).click()
    await expect(editor().getByRole('alert')).toContainText('Connection refused')

    await editor().getByRole('radio', { name: 'LDAPS' }).click()
    await editor().getByLabel('Port').fill(String(LDAPS_PORT))
    await editor().getByLabel('Host').fill('127.0.0.1')
    await editor().getByRole('button', { name: 'Test connection' }).click()
    await expect(editor().getByRole('alert')).toContainText('not valid for this host name')
    // Testing does not save: after cancelling, no profile was created.
    await editor().getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('listitem', { name: 'Test' })).toHaveCount(0)
  })

  test('creates, edits, duplicates and deletes a profile with confirmation', async () => {
    await createProfile({ name: 'Prod', encryption: 'None', port: OPENLDAP.port, bindDn: OPENLDAP.adminDn })

    await row('Prod').getByRole('button', { name: 'More actions for Prod' }).click()
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    await editor().getByLabel('Name').fill('Production')
    await editor().getByRole('button', { name: 'Save changes' }).click()
    await expect(row('Production')).toBeVisible()

    await row('Production').getByRole('button', { name: 'More actions for Production' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(row('Production (copy)')).toContainText('localhost:3389')

    await row('Production (copy)').getByRole('button', { name: 'More actions for Production (copy)' }).click()
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    await expect(page.getByRole('dialog')).toContainText('Delete “Production (copy)”?')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    // While a dialog is open the rest of the page is aria-hidden, so wait for it to close.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(row('Production (copy)')).toHaveCount(0)
    await expect(row('Production')).toBeVisible()
  })
})

test.describe('connections pane (task 8.1)', () => {
  test('connects two profiles at once and disconnects one', async () => {
    await createProfile({
      name: 'OpenLDAP',
      encryption: 'None',
      port: OPENLDAP.port,
      bindDn: OPENLDAP.adminDn,
      password: OPENLDAP.adminPassword,
    })
    await createProfile({
      name: '389-DS',
      encryption: 'None',
      port: DS389.port,
      bindDn: DS389.adminDn,
      password: DS389.adminPassword,
    })
    await expect(row('OpenLDAP')).toHaveAttribute('data-status', 'disconnected')

    await row('OpenLDAP').getByRole('button', { name: 'Connect' }).click()
    await row('389-DS').dblclick()
    await expect(row('OpenLDAP')).toHaveAttribute('data-status', 'connected')
    await expect(row('389-DS')).toHaveAttribute('data-status', 'connected')
    await expect(row('389-DS').getByRole('img', { name: 'Connected' })).toBeVisible()

    await row('OpenLDAP').getByRole('button', { name: 'Disconnect' }).click()
    await expect(row('OpenLDAP')).toHaveAttribute('data-status', 'disconnected')
    await expect(row('389-DS')).toHaveAttribute('data-status', 'connected')
  })

  test('shows a connection failure on the row and offers to reconnect', async () => {
    await createProfile({ name: 'Nowhere', encryption: 'None', port: 1 })
    await row('Nowhere').getByRole('button', { name: 'Connect' }).click()
    await expect(row('Nowhere')).toHaveAttribute('data-status', 'error')
    await expect(row('Nowhere')).toContainText('Connection refused')
    await expect(row('Nowhere').getByRole('button', { name: 'Reconnect' })).toBeVisible()
  })
})

test.describe('password prompt and certificate trust (task 8.3)', () => {
  test('asks for a password, asks again after a wrong one, and asks again on the next connect when not saved', async () => {
    await createProfile({
      name: 'Prompted',
      encryption: 'None',
      port: OPENLDAP.port,
      bindDn: OPENLDAP.adminDn,
    })
    await row('Prompted').getByRole('button', { name: 'Connect' }).click()

    const prompt = page.getByRole('dialog', { name: 'Connect to Prompted' })
    await prompt.getByLabel('Password', { exact: true }).fill('wrong-password')
    await prompt.getByRole('button', { name: 'Connect' }).click()
    await expect(prompt).toContainText('Invalid credentials')
    await expect(prompt.getByLabel('Password', { exact: true })).toHaveValue('')

    await prompt.getByLabel('Password', { exact: true }).fill(OPENLDAP.adminPassword)
    await prompt.getByRole('button', { name: 'Connect' }).click()
    await expect(row('Prompted')).toHaveAttribute('data-status', 'connected')

    await row('Prompted').getByRole('button', { name: 'Disconnect' }).click()
    await row('Prompted').getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByRole('dialog', { name: 'Connect to Prompted' })).toBeVisible()
  })

  test('saves the password from the prompt when asked to', async () => {
    await createProfile({
      name: 'Remembered',
      encryption: 'None',
      port: OPENLDAP.port,
      bindDn: OPENLDAP.adminDn,
    })
    await row('Remembered').getByRole('button', { name: 'Connect' }).click()
    const prompt = page.getByRole('dialog', { name: 'Connect to Remembered' })
    await prompt.getByLabel('Password', { exact: true }).fill(OPENLDAP.adminPassword)
    await prompt.getByLabel('Save password').check()
    await prompt.getByRole('button', { name: 'Connect' }).click()
    await expect(row('Remembered')).toHaveAttribute('data-status', 'connected')
    await row('Remembered').getByRole('button', { name: 'Disconnect' }).click()
    await row('Remembered').getByRole('button', { name: 'Connect' }).click()
    await expect(row('Remembered')).toHaveAttribute('data-status', 'connected')
  })

  test('shows an untrusted certificate, trusts it, and reconnects without asking', async () => {
    await createProfile({
      name: 'Untrusted',
      encryption: 'LDAPS',
      port: LDAPS_PORT,
      bindDn: OPENLDAP.adminDn,
      password: OPENLDAP.adminPassword,
    })
    await row('Untrusted').getByRole('button', { name: 'Connect' }).click()
    const dialog = page.getByRole('dialog', { name: 'The server certificate is not trusted' })
    await expect(dialog).toContainText('CN=localhost')
    await expect(dialog).toContainText('CN=LDAP Studio Test CA')
    await expect(dialog).toContainText('SHA-256 fingerprint')
    await expect(dialog).toContainText('certificate authority that is not trusted')
    await dialog.getByRole('button', { name: 'Trust and connect' }).click()
    await expect(row('Untrusted')).toHaveAttribute('data-status', 'connected')

    await row('Untrusted').getByRole('button', { name: 'Disconnect' }).click()
    await row('Untrusted').getByRole('button', { name: 'Connect' }).click()
    await expect(row('Untrusted')).toHaveAttribute('data-status', 'connected')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
