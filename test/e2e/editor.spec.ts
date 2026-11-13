import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { Attribute, Change, Client } from 'ldapts'
import { startTcpProxy } from '../integration/tcp-proxy'
import { goToDn, launchApp, relaunch, type LaunchedApp } from './app'
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
  await goToDn(page, dn)
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
    await expect(attribute('cn').getByRole('img', { name: 'Required' })).toBeVisible()
    await expect(attribute('sn').getByRole('img', { name: 'Required' })).toBeVisible()
    await expect(attribute('mail').getByRole('img', { name: 'Required' })).toHaveCount(0)
    await expect(attribute('mail').getByRole('img', { name: 'Read-only' })).toHaveCount(0)
    await expect(valueInputs('telephoneNumber')).toHaveCount(2)
  })

  test('collapses attributes with more than 10 values to their count', async () => {
    await admin.modify(entryDn, [
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'mail',
          values: Array.from({ length: 11 }, (_, index) => `user${index}@example.com`),
        }),
      }),
    ])
    await open(entryDn)
    const toggle = attribute('mail').getByRole('button', { name: 'Expand mail values' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(attribute('mail')).toContainText('11 values')
    await expect(valueInputs('mail')).toHaveCount(0)
    // Ten values or fewer stay expanded, without a toggle.
    await expect(attribute('cn').getByRole('button', { name: /cn values/ })).toHaveCount(0)

    await toggle.click()
    await expect(valueInputs('mail')).toHaveCount(11)
    await attribute('mail').getByRole('button', { name: 'Collapse mail values' }).click()
    await expect(valueInputs('mail')).toHaveCount(0)
    // The count expands it too.
    await attribute('mail').getByRole('button', { name: '11 values' }).click()
    await expect(valueInputs('mail')).toHaveCount(11)
  })

  test('shows operational attributes on request, read-only', async () => {
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    await expect(attribute('createTimestamp')).toHaveCount(0)
    await editor().getByLabel('Show operational attributes').check()
    await expect(attribute('createTimestamp').getByRole('img', { name: 'Read-only' })).toBeVisible()
    await expect(valueInputs('createTimestamp')).toHaveCount(0)
  })

  test('lists objectClass, then required, then the rest, with operational attributes last', async () => {
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    await editor().getByLabel('Show operational attributes').check()
    await expect(attribute('createTimestamp')).toBeVisible()
    const names = await editor()
      .getByRole('table', { name: 'Attributes' })
      .getByRole('rowgroup')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('aria-label') ?? ''))
    const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' })
    const required = ['cn', 'gidNumber', 'homeDirectory', 'sn', 'uid', 'uidNumber']
    const operational = names.filter((name) =>
      [
        'createTimestamp',
        'creatorsName',
        'entryCSN',
        'entryDN',
        'entryUUID',
        'hasSubordinates',
        'modifiersName',
        'modifyTimestamp',
        'structuralObjectClass',
        'subschemaSubentry',
      ].includes(name),
    )
    const rest = names.filter(
      (name) => name !== 'objectClass' && !required.includes(name) && !operational.includes(name),
    )
    expect(names).toEqual([
      'objectClass',
      ...required,
      ...[...rest].sort(byName),
      ...[...operational].sort(byName),
    ])
  })

  test('scrolls the object class tags sideways when they do not fit', async () => {
    await page.setViewportSize({ width: 820, height: 700 })
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    const tags = editor().getByRole('list', { name: 'Object classes' })
    await expect(tags).toHaveAttribute('data-overflowing', 'true')
    const size = () =>
      tags.evaluate((element) => ({
        scrollLeft: element.scrollLeft,
        height: element.getBoundingClientRect().height,
      }))
    // One row, no scrollbar: the height stays that of a tag.
    expect((await size()).height).toBe(20)
    await tags.hover()
    await page.mouse.wheel(0, 200)
    await expect.poll(async () => (await size()).scrollLeft).toBeGreaterThan(0)
    await expect(tags.getByRole('listitem').last()).toBeInViewport()
  })

  test('copies the DN from the path bar and confirms it for a moment', async () => {
    await open('uid=jdoe,ou=people,dc=example,dc=com')
    const button = editor().getByRole('button', { name: 'Copy DN' })
    await button.click()
    await expect
      .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('uid=jdoe,ou=people,dc=example,dc=com')
    // A green check and "Copied" for about two seconds, then the copy icon again.
    await expect(button).toHaveAttribute('data-copied', 'true')
    await expect(button).toHaveAttribute('title', 'Copied')
    await expect(button.getByRole('status')).toHaveText('Copied')
    await expect(button).not.toHaveAttribute('data-copied', /.*/, { timeout: 4000 })
    await expect(button).toHaveAttribute('title', 'Copy DN')
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
    const list = page.getByRole('listbox', { name: 'Attribute to add' })
    const suggestions = await list.getByRole('option').allTextContents()
    expect(suggestions).toContain('displayName')
    expect(suggestions).toContain('title')
    expect(suggestions).not.toContain('uidNumber')
    expect(suggestions).not.toContain('mail')

    // The list is long; it scrolls instead of running off the window.
    const scroller = list.locator('ul')
    const { scrollHeight, clientHeight } = await scroller.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))
    expect(scrollHeight).toBeGreaterThan(clientHeight)
    await scroller.hover()
    await page.mouse.wheel(0, 400)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    // Typing filters; the arrow keys pick an option.
    await editor().getByLabel('Attribute to add').fill('isplayNa')
    await expect(list.getByRole('option')).toHaveText(['displayName'])
    await page.keyboard.press('ArrowDown')
    await expect(list.getByRole('option', { name: 'displayName' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(valueInputs('displayName')).toBeFocused()
    await valueInputs('displayName').fill('Tester')
    await attribute('displayName').hover()
    await expect(attribute('displayName').getByRole('button', { name: 'Add displayName value' })).toHaveCount(
      0,
    )
  })
  test('closes an accidentally opened attribute field without adding anything', async () => {
    await open(entryDn)
    const addButton = editor().getByRole('button', { name: 'Add attribute' })
    const field = editor().getByLabel('Attribute to add')

    // Cancel, and Add stays disabled while nothing is typed.
    await addButton.click()
    await expect(editor().getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
    await editor().getByRole('button', { name: 'Cancel' }).click()
    await expect(field).toHaveCount(0)

    // Clicking elsewhere closes it while it is empty...
    await addButton.click()
    await editor().getByRole('heading', { name: 'Test Person' }).click()
    await expect(field).toHaveCount(0)

    // ...but dragging the list's scrollbar does not.
    await addButton.click()
    const scroller = page.getByRole('listbox', { name: 'Attribute to add' }).locator('ul')
    // Hovering waits until the popover has stopped moving, so the measured box is final.
    await scroller.hover()
    const box = (await scroller.boundingBox())!
    await page.mouse.move(box.x + box.width - 3, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 3, box.y + 120, { steps: 5 })
    await page.mouse.up()
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(field).toBeFocused()

    // With text typed, clicking elsewhere keeps what was typed; Escape closes it.
    await field.fill('desc')
    await editor().getByRole('heading', { name: 'Test Person' }).click()
    await expect(field).toHaveValue('desc')
    await field.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(editor()).not.toContainText('unsaved')
  })
})

test.describe('choosing DN values (entry-editing spec)', () => {
  test('picks a member from the directory, starting at the current value', async () => {
    const group = `cn=Team,${container}`
    await admin.add(group, {
      objectClass: ['top', 'groupOfNames'],
      cn: 'Team',
      member: 'uid=jdoe,ou=people,dc=example,dc=com',
    })
    try {
      await open(group)
      const member = attribute('member')
      await member.hover()
      // Only DN-valued attributes offer it.
      await expect(attribute('cn').getByRole('button', { name: /from the directory/ })).toHaveCount(0)
      await member.getByRole('button', { name: 'Choose member value from the directory' }).click()

      const dialog = page.getByRole('dialog', { name: 'Choose member' })
      const entries = dialog.getByRole('tree', { name: 'Entries to choose from' })
      // Opened at the current value, with the entries down to it loaded.
      await expect(entries.getByRole('treeitem', { name: 'uid=jdoe', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await entries.getByRole('treeitem', { name: 'uid=asmith', exact: true }).click()
      await expect(dialog).toContainText('uid=asmith,ou=people,dc=example,dc=com')
      await dialog.getByRole('button', { name: 'Choose' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(valueInputs('member')).toHaveValue('uid=asmith,ou=people,dc=example,dc=com')
      await expect(member.getByRole('img', { name: 'Changed' })).toBeVisible()

      // Double-click chooses too; Cancel changes nothing.
      await member.hover()
      await member.getByRole('button', { name: 'Choose member value from the directory' }).click()
      await entries.getByRole('treeitem', { name: 'uid=bwayne', exact: true }).dblclick()
      await expect(valueInputs('member')).toHaveValue('uid=bwayne,ou=people,dc=example,dc=com')
      await member.hover()
      await member.getByRole('button', { name: 'Choose member value from the directory' }).click()
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(valueInputs('member')).toHaveValue('uid=bwayne,ou=people,dc=example,dc=com')
    } finally {
      await admin.del(group).catch(() => undefined)
    }
  })

  test('opens the chooser for a new, empty value at the top of the directory', async () => {
    await open(entryDn)
    await editor().getByRole('button', { name: 'Add attribute' }).click()
    await editor().getByLabel('Attribute to add').fill('seeAlso')
    await editor().getByLabel('Attribute to add').press('Enter')
    await expect(valueInputs('seeAlso')).toBeFocused()
    await attribute('seeAlso').hover()
    await attribute('seeAlso')
      .getByRole('button', { name: 'Choose seeAlso value from the directory' })
      .click()
    const entries = page
      .getByRole('dialog', { name: 'Choose seeAlso' })
      .getByRole('tree', { name: 'Entries to choose from' })
    await expect(entries.getByRole('treeitem', { name: 'dc=example,dc=com', exact: true })).toBeVisible()
    // The first root is opened, so there is something to pick right away.
    await entries.getByRole('treeitem', { name: 'ou=people', exact: true }).dblclick()
    await expect(valueInputs('seeAlso')).toHaveValue('ou=people,dc=example,dc=com')
  })

  test('searches every subtree from the chooser', async () => {
    await open(entryDn)
    await editor().getByRole('button', { name: 'Add attribute' }).click()
    await editor().getByLabel('Attribute to add').fill('seeAlso')
    await editor().getByLabel('Attribute to add').press('Enter')
    await attribute('seeAlso').hover()
    await attribute('seeAlso')
      .getByRole('button', { name: 'Choose seeAlso value from the directory' })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Choose seeAlso' })
    const search = dialog.getByRole('searchbox', { name: 'Search all entries' })
    await expect(search).toBeFocused()
    await search.fill('asmit')
    // The match is found below ou=people without expanding it, shown with the entries leading to it.
    const matches = dialog.getByRole('tree', { name: 'Matching entries' })
    await expect(matches.getByRole('treeitem', { name: 'uid=asmith', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(matches.getByRole('treeitem', { name: 'ou=people', exact: true })).toBeVisible()
    await search.press('Enter')
    await expect(valueInputs('seeAlso')).toHaveValue('uid=asmith,ou=people,dc=example,dc=com')
  })
})

test.describe('setting passwords (entry-editing spec)', () => {
  const setPassword = () => page.getByRole('dialog', { name: 'Set password' })

  test('hashes a new password that the server then accepts for binding', async () => {
    await admin.modify(entryDn, [
      new Change({
        operation: 'add',
        modification: new Attribute({ type: 'userPassword', values: ['old-pw'] }),
      }),
    ])
    await open(entryDn)
    const password = attribute('userPassword')
    await expect(password).toContainText('Plaintext password')
    await password.hover()
    // Passwords are set, not uploaded or downloaded.
    await expect(password.getByRole('button', { name: /file/ })).toHaveCount(0)
    await password.getByRole('button', { name: 'Set userPassword value' }).click()

    const dialog = setPassword()
    const ok = dialog.getByRole('button', { name: 'OK' })
    await expect(dialog.getByLabel('Hash method')).toHaveValue('SSHA-512')
    await dialog.getByLabel('New password', { exact: true }).fill('new-pw')
    await dialog.getByLabel('Confirm password').fill('new-px')
    await expect(dialog).toContainText('The passwords do not match.')
    await expect(ok).toBeDisabled()
    await dialog.getByLabel('Confirm password').fill('new-pw')
    await expect(ok).toBeEnabled()

    // The test server supports only the SHA-1 schemes.
    await dialog.getByLabel('Hash method').selectOption('SSHA')
    const stored = dialog.getByLabel('Stored value')
    await expect(stored).toHaveValue(/^\{SSHA\}/)
    const first = await stored.inputValue()
    await dialog.getByRole('button', { name: 'New salt' }).click()
    await expect(stored).not.toHaveValue(first)
    await ok.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(password).toContainText('SSHA password')
    await expect(password.getByRole('img', { name: 'Changed' })).toBeVisible()

    await editor().getByRole('button', { name: 'Review and save…' }).click()
    await page
      .getByRole('dialog', { name: 'Review changes' })
      .getByRole('button', { name: 'Save changes' })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await serverValues('userPassword')).toEqual([expect.stringMatching(/^\{SSHA\}/)])
    const user = new Client({ url: `ldap://${OPENLDAP.host}:${OPENLDAP.port}` })
    try {
      await user.bind(entryDn, 'new-pw')
    } finally {
      await user.unbind()
    }
  })

  test('asks for the password when the attribute is added, and adds nothing on cancel', async () => {
    await open(entryDn)
    const addAttribute = async () => {
      await editor().getByRole('button', { name: 'Add attribute' }).click()
      await editor().getByRole('combobox', { name: 'Attribute to add' }).fill('userPassword')
      await editor().getByRole('button', { name: 'Add', exact: true }).click()
    }
    await addAttribute()
    await setPassword().getByRole('button', { name: 'Cancel' }).click()
    await expect(attribute('userPassword')).toHaveCount(0)

    await addAttribute()
    await setPassword().getByLabel('New password', { exact: true }).fill('pw')
    await setPassword().getByLabel('Confirm password').fill('pw')
    await setPassword().getByRole('button', { name: 'OK' }).click()
    await expect(attribute('userPassword')).toContainText('SSHA-512 password')
  })
})

test.describe('multi-line values (entry-editing spec)', () => {
  const sixLines = ['objectClass:', '  - posixAccount', 'uidNumber:', '  value: 1000', '  type: sub', 'end']
  const description = () => valueInputs('description')

  async function setDescription(values: string[]): Promise<void> {
    await admin.modify(entryDn, [
      new Change({ operation: 'replace', modification: new Attribute({ type: 'description', values }) }),
    ])
  }

  test('shows multi-line values in text areas up to five lines high, and single lines in inputs', async () => {
    await setDescription([sixLines.join('\n'), 'first\nsecond', 'just one line'])
    await open(entryDn)
    await expect(description()).toHaveCount(3)
    const [six, two, one] = [description().nth(0), description().nth(1), description().nth(2)]
    await expect(six).toHaveJSProperty('tagName', 'TEXTAREA')
    await expect(six).toHaveValue(sixLines.join('\n'))
    await expect(six).toHaveAttribute('rows', '5')
    // Five lines show; the sixth needs scrolling.
    expect(await six.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect(two).toHaveJSProperty('tagName', 'TEXTAREA')
    await expect(two).toHaveAttribute('rows', '2')
    await expect(one).toHaveJSProperty('tagName', 'INPUT')
  })

  test('resizes a text area vertically only', async () => {
    await setDescription(['first\nsecond'])
    await open(entryDn)
    const field = description()
    expect(await field.evaluate((element) => getComputedStyle(element).resize)).toBe('vertical')
    const before = await field.boundingBox()
    if (!before) {
      throw new Error('The text area is not visible.')
    }
    // Drag the resize handle in the bottom-right corner down and to the right.
    await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3)
    await page.mouse.down()
    await page.mouse.move(before.x + before.width + 60, before.y + before.height + 60, { steps: 5 })
    await page.mouse.up()
    const after = await field.boundingBox()
    expect(after?.height).toBeGreaterThan(before.height + 40)
    expect(after?.width).toBe(before.width)
  })

  test('saves an edited line and keeps the other lines and line breaks', async () => {
    await setDescription(['line one\nline two\nline three', 'a\r\nb\r\nc'])
    await open(entryDn)
    await description().nth(0).fill('line one\nline 2\nline three')
    // A text area hands back LF only; the value's CR LF must come back.
    await description().nth(1).fill('a\nB\nc')
    await editor().getByRole('button', { name: 'Review and save…' }).click()
    await page
      .getByRole('dialog', { name: 'Review changes' })
      .getByRole('button', { name: 'Save changes' })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await serverValues('description')).sort()).toEqual([
      'a\r\nB\r\nc',
      'line one\nline 2\nline three',
    ])
  })

  test('keeps the text area and the focus when every line break is deleted', async () => {
    await setDescription(['ab\ncd'])
    await open(entryDn)
    await description().fill('abcd')
    await expect(description()).toHaveJSProperty('tagName', 'TEXTAREA')
    await expect(description()).toBeFocused()
    await page.keyboard.type('e')
    await expect(description()).toHaveValue('abcde')
  })

  test('shows multi-line values in the change preview, each five lines high and scrollable', async () => {
    const eightLines = (name: string) =>
      Array.from({ length: 8 }, (_, index) => `${name} ${index + 1}`).join('\n')
    await setDescription([eightLines('first'), eightLines('second')])
    await open(entryDn)
    await description().nth(0).fill(eightLines('changed first'))
    await description().nth(1).fill(eightLines('changed second'))
    await editor().getByRole('button', { name: 'Review and save…' }).click()
    const preview = page.getByRole('dialog', { name: 'Review changes' })
    const values = preview.getByRole('region', { name: 'description value' })
    // Both values changed, so the preview lists one replace with the two new values.
    await expect(values).toHaveCount(2)
    for (const value of await values.all()) {
      expect(await value.innerText()).toMatch(/ 1\n.* 2\n/)
      const box = await value.evaluate((element) => ({
        lines: element.clientHeight / parseFloat(getComputedStyle(element).lineHeight),
        scrolls: element.scrollHeight > element.clientHeight,
        focusable: element.tabIndex === 0,
      }))
      expect(box).toEqual({ lines: 5, scrolls: true, focusable: true })
    }
  })

  test('shows a read-only multi-line value with its line breaks', async () => {
    await setDescription([sixLines.join('\n')])
    // Connect through a proxy the test can cut: a lost connection makes the entry read-only.
    const proxy = await startTcpProxy(OPENLDAP.host, OPENLDAP.port)
    try {
      await page.evaluate(
        async ({ port, server }) => {
          await window.api.invoke('profiles.save', {
            name: 'Proxied',
            host: '127.0.0.1',
            port,
            security: 'none',
            bindDn: server.adminDn,
            baseDn: '',
            caCertificates: [],
            password: { action: 'set', value: server.adminPassword },
          })
        },
        { port: proxy.port, server: OPENLDAP },
      )
      launched = await relaunch(launched)
      page = launched.window
      const row = page.getByRole('listitem', { name: 'Proxied' })
      await row.getByRole('button', { name: 'Connect' }).click()
      await expect(row).toHaveAttribute('data-status', 'connected')
      await open(entryDn)
      await expect(description()).toHaveJSProperty('tagName', 'TEXTAREA')

      proxy.dropAll()

      await expect(editor()).toContainText('cannot be changed until you reconnect')
      await expect(description()).toHaveCount(0)
      const shown = attribute('description').getByRole('row').first()
      expect(await shown.innerText()).toBe(sixLines.join('\n'))
    } finally {
      await proxy.close()
    }
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
    const copySn = attribute('sn').getByRole('button', { name: 'Copy sn value' })
    await copySn.click()
    await expect.poll(readClipboard).toBe('Person')
    // The confirmation stays visible even after the pointer leaves the row (and without focus,
    // which would keep the row's actions visible anyway).
    await page.mouse.move(0, 0)
    await copySn.evaluate((button) => button.blur())
    await expect(copySn).toHaveAttribute('data-copied', 'true')
    // (Playwright counts opacity 0 as visible, so check the hover group's opacity itself.)
    const opacity = () => copySn.evaluate((button) => getComputedStyle(button.parentElement!).opacity)
    await expect.poll(opacity).toBe('1')
    // Once the confirmation is over, the actions hide again with the pointer away.
    await expect.poll(opacity, { timeout: 4000 }).toBe('0')
    await attribute('mail').hover()
    await attribute('mail').getByRole('button', { name: 'Copy all mail values' }).click()
    await expect.poll(readClipboard).toBe('a@example.com\nb@example.com')
  })
})
