import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { Client } from 'ldapts'
import { goToDn, launchApp, relaunch, type LaunchedApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

const PHOTO = readFileSync(resolve(__dirname, '../ldap/seed/photo.jpg'))
/** A small PNG (1×1 pixel), different from the seeded JPEG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let launched: LaunchedApp
let page: Page
let admin: Client
let files: string
let container: string
let entryDn: string

test.beforeEach(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  files = mkdtempSync(join(tmpdir(), 'ldap-studio-binary-'))
  admin = new Client({ url: `ldap://${OPENLDAP.host}:${OPENLDAP.port}` })
  await admin.bind(OPENLDAP.adminDn, OPENLDAP.adminPassword)
  const name = `e2e-${randomUUID().slice(0, 8)}`
  container = `ou=${name},dc=example,dc=com`
  entryDn = `cn=Pictured,${container}`
  await admin.add(container, { objectClass: ['top', 'organizationalUnit'], ou: name })
  await admin.add(entryDn, {
    objectClass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'],
    cn: 'Pictured',
    sn: 'Person',
    mail: 'pictured@example.com',
    // ldapts accepts Buffers at runtime; its typings only list strings.
    jpegPhoto: PHOTO as unknown as string,
  })

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
  await admin?.del(entryDn).catch(() => undefined)
  await admin?.del(container).catch(() => undefined)
  await admin?.unbind()
  rmSync(files, { recursive: true, force: true })
})

const editor = () => page.getByRole('region', { name: 'Entry' })
const attribute = (name: string) => editor().getByRole('rowgroup', { name, exact: true })

async function open(dn: string): Promise<void> {
  await goToDn(page, dn)
  await expect(editor().getByRole('navigation', { name: 'Entry path' })).toBeVisible()
}

async function storedPhotos(): Promise<Buffer[]> {
  const { searchEntries } = await admin.search(entryDn, {
    scope: 'base',
    attributes: ['jpegPhoto'],
    explicitBufferAttributes: ['jpegPhoto'],
  })
  return [searchEntries[0]?.['jpegPhoto'] ?? []].flat() as Buffer[]
}

/** The OS file dialogs cannot be driven by tests; make them return these paths. */
async function stubDialogs(paths: { open?: string; save?: string }): Promise<void> {
  await launched.app.evaluate(({ dialog }, { open, save }) => {
    if (open) {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [open],
      })) as typeof dialog.showOpenDialog
    }
    if (save) {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: save,
      })) as typeof dialog.showSaveDialog
    }
  }, paths)
}

async function saveChanges(): Promise<void> {
  await editor().getByRole('button', { name: 'Review and save…' }).click()
  await page
    .getByRole('dialog', { name: 'Review changes' })
    .getByRole('button', { name: 'Save changes' })
    .click()
  // While the dialog is open the editor is aria-hidden; wait until saving has closed it.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // A server error also replaces the "unsaved" text, so check that no error is shown.
  await expect(editor().getByRole('button', { name: 'Review and save…' })).toHaveCount(0)
  await expect(editor().getByRole('alert')).toHaveCount(0)
}

test.describe('binary value display (task 12.1)', () => {
  test('shows an image as a thumbnail and a certificate decoded', async () => {
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    await expect(attribute('jpegPhoto').getByRole('img', { name: 'Image value' })).toBeVisible()
    await expect(attribute('jpegPhoto')).toContainText('JPEG image, 2.3 KB')
    const certificate = attribute('userCertificate;binary')
    await expect(certificate).toContainText('CN=localhost')
    await expect(certificate).toContainText('Issued by CN=LDAP Studio Test CA')
    await expect(certificate).toContainText(/Valid until|Expired/)
  })
})

test.describe('binary files (task 12.2)', () => {
  test('saves a value to a file byte-exact', async () => {
    const target = join(files, 'saved.jpg')
    await stubDialogs({ save: target })
    await open(entryDn)
    await attribute('jpegPhoto').hover()
    await attribute('jpegPhoto').getByRole('button', { name: 'Save jpegPhoto value to a file' }).click()
    await expect
      .poll(() => {
        try {
          return readFileSync(target).equals(PHOTO)
        } catch {
          return false
        }
      })
      .toBe(true)
  })

  test('saves a certificate to a file with exactly the stored bytes', async () => {
    const dn = 'uid=jdoe,ou=people,dc=example,dc=com'
    const target = join(files, 'jdoe.cer')
    await stubDialogs({ save: target })
    await open(dn)
    const certificate = attribute('userCertificate;binary')
    await certificate.hover()
    await certificate.getByRole('button', { name: 'Save userCertificate;binary value to a file' }).click()
    const { searchEntries } = await admin.search(dn, {
      scope: 'base',
      attributes: ['userCertificate;binary'],
      explicitBufferAttributes: ['userCertificate;binary'],
    })
    const stored = [searchEntries[0]?.['userCertificate;binary'] ?? []].flat()[0] as Buffer
    expect(stored.length).toBeGreaterThan(0)
    await expect
      .poll(() => {
        try {
          return readFileSync(target).equals(stored)
        } catch {
          return false
        }
      })
      .toBe(true)
  })

  test('replaces a value from a file and the server stores exactly its bytes', async () => {
    const source = join(files, 'replacement.png')
    writeFileSync(source, PNG)
    await stubDialogs({ open: source })
    await open(entryDn)
    await attribute('jpegPhoto').hover()
    await attribute('jpegPhoto').getByRole('button', { name: 'Replace jpegPhoto value from a file' }).click()
    await expect(attribute('jpegPhoto')).toContainText('PNG image')
    await saveChanges()
    const stored = await storedPhotos()
    expect(stored).toHaveLength(1)
    expect(stored[0]!.equals(PNG)).toBe(true)
  })

  test('adds a value from a file', async () => {
    const source = join(files, 'second.png')
    writeFileSync(source, PNG)
    await stubDialogs({ open: source })
    await open(entryDn)
    await attribute('jpegPhoto').hover()
    await attribute('jpegPhoto').getByRole('button', { name: 'Add jpegPhoto value' }).click()
    await expect(attribute('jpegPhoto').getByRole('img', { name: 'Image value' })).toHaveCount(2)
    await saveChanges()
    const stored = await storedPhotos()
    expect(stored.map((value) => value.length).sort()).toEqual([PHOTO.length, PNG.length].sort())
  })

  test('leaves a binary value byte-identical when another attribute is saved', async () => {
    await open(entryDn)
    await attribute('mail').getByLabel('mail value', { exact: true }).fill('changed@example.com')
    await saveChanges()
    const stored = await storedPhotos()
    expect(stored).toHaveLength(1)
    expect(stored[0]!.equals(PHOTO)).toBe(true)
  })
})
