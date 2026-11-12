import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { Client } from 'ldapts'
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
  const name = `e2e-${randomUUID().slice(0, 8)}`
  container = `ou=${name},dc=example,dc=com`
  entryDn = `cn=Keys,${container}`
  await admin.add(container, { objectClass: ['top', 'organizationalUnit'], ou: name })
  await admin.add(entryDn, { objectClass: ['top', 'person'], cn: 'Keys', sn: 'Before' })

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
})

const editor = () => page.getByRole('region', { name: 'Entry' })
const snInput = () =>
  editor().getByRole('rowgroup', { name: 'sn', exact: true }).getByLabel('sn value', { exact: true })

async function open(dn: string): Promise<void> {
  await page.getByLabel('Go to DN').fill(dn)
  await page.getByLabel('Go to DN').press('Enter')
  await expect(editor().getByRole('heading', { name: 'Keys' })).toBeVisible()
}

async function storedSn(): Promise<string> {
  const { searchEntries } = await admin.search(entryDn, { scope: 'base', attributes: ['sn'] })
  return String(searchEntries[0]?.['sn'])
}

test.describe('keyboard shortcuts (task 7.6)', () => {
  test('Cmd/Ctrl+L focuses the DN lookup with its contents selected', async () => {
    const lookup = page.getByLabel('Go to DN')
    await lookup.fill('dc=example,dc=com')
    await page.getByRole('tree', { name: 'Directory tree' }).focus()
    await page.keyboard.press('ControlOrMeta+l')
    await expect(lookup).toBeFocused()
    const selection = await lookup.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ])
    expect(selection).toEqual([0, 'dc=example,dc=com'.length])
  })

  test('Cmd/Ctrl+F opens the search with the filter focused', async () => {
    await page.getByRole('tab', { name: 'Log' }).click()
    await page.getByRole('tree', { name: 'Directory tree' }).focus()
    await page.keyboard.press('ControlOrMeta+f')
    await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Filter', { exact: true })).toBeFocused()
  })

  test('Cmd/Ctrl+S opens the review and saves from there', async () => {
    await open(entryDn)
    await snInput().fill('After')
    await page.keyboard.press('ControlOrMeta+s')
    const review = page.getByRole('dialog', { name: 'Review changes' })
    await expect(review).toBeVisible()
    await review.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(editor().getByRole('button', { name: 'Review and save…' })).toHaveCount(0)
    expect(await storedSn()).toBe('After')
  })

  test('Cmd/Ctrl+Shift+Backspace discards unsaved changes', async () => {
    await open(entryDn)
    await snInput().fill('Changed')
    await expect(editor().getByRole('button', { name: 'Discard' })).toBeEnabled()
    await page.keyboard.press('ControlOrMeta+Shift+Backspace')
    await expect(snInput()).toHaveValue('Before')
    await expect(editor().getByRole('button', { name: 'Discard' })).toHaveCount(0)
    expect(await storedSn()).toBe('Before')
  })

  test('Cmd/Ctrl+/ toggles the shortcuts overlay, which lists every shortcut', async () => {
    await page.keyboard.press('ControlOrMeta+/')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()
    for (const text of [
      'Go to a DN',
      'Open the search',
      'Review and save the entry, or create a new one',
      'Discard unsaved changes',
      'Show keyboard shortcuts',
    ]) {
      await expect(dialog.getByText(text, { exact: true })).toBeVisible()
    }
    await page.keyboard.press('ControlOrMeta+/')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: /^Keyboard shortcuts/ }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('workspace shortcuts wait while a dialog is open', async () => {
    await page.keyboard.press('ControlOrMeta+/')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+l')
    await expect(page.getByLabel('Go to DN')).not.toBeFocused()
  })
})
