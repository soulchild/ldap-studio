import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { Client } from 'ldapts'
import { startTcpProxy } from '../integration/tcp-proxy'
import { launchApp, relaunch, type LaunchedApp } from './app'
import { OPENLDAP, READER, testServersRunning } from './ldap-env'

let launched: LaunchedApp
let page: Page

test.beforeEach(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  launched = await launchApp()
  page = launched.window
  // Bind as the reader, which is subject to the server's size limit of 100 entries.
  await page.evaluate(
    async ({ server, reader }) => {
      await window.api.invoke('profiles.save', {
        name: 'Test',
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
  // Restart so the app picks up the profile.
  launched = await relaunch(launched)
  page = launched.window
  await page.getByRole('listitem', { name: 'Test' }).getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByRole('listitem', { name: 'Test' })).toHaveAttribute('data-status', 'connected')
})

test.afterEach(async () => {
  await launched?.close()
})

const tree = () => page.getByRole('tree', { name: 'Directory tree' })
const item = (name: string) => tree().getByRole('treeitem', { name, exact: true })

test('shows the naming context as root and loads children on expand', async () => {
  await expect(item('dc=example,dc=com')).toHaveAttribute('aria-expanded', 'false')
  await tree().getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
  await expect(item('ou=people')).toBeVisible()
  await expect(item('ou=groups')).toBeVisible()
  await expect(item('ou=bulk')).toBeVisible()
  await expect(item('dc=example,dc=com')).toHaveAttribute('aria-expanded', 'true')
})

test('lists all 5,000 children of a large container, past the server size limit', async () => {
  await tree().getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
  await tree().getByRole('button', { name: 'Expand ou=bulk' }).click()
  await expect(item('ou=bulk')).toContainText('5,000')
  await expect(item('cn=user00001')).toBeVisible()
  await expect(tree().getByRole('status')).toHaveCount(0)
})

test('shows leaves without an expand control', async () => {
  await tree().getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
  await tree().getByRole('button', { name: 'Expand ou=people' }).click()
  await expect(item('uid=jdoe')).toBeVisible()
  await expect(item('uid=jdoe')).not.toHaveAttribute('aria-expanded')
  await expect(tree().getByRole('button', { name: 'Expand uid=jdoe' })).toHaveCount(0)
})

test('navigates with the keyboard', async () => {
  await item('dc=example,dc=com').click()
  await expect(item('dc=example,dc=com')).toHaveAttribute('aria-selected', 'true')
  await tree().focus()
  await page.keyboard.press('ArrowRight')
  await expect(item('ou=bulk')).toBeVisible()
  // Children are sorted once loading finishes; before that they are in server order.
  await expect(tree().getByRole('status')).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(item('ou=bulk')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(item('ou=groups')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(item('dc=example,dc=com')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(item('dc=example,dc=com')).toHaveAttribute('aria-expanded', 'false')
  await expect(item('ou=groups')).toHaveCount(0)
})

test('stays responsive with 100,000 nodes (performance check)', async () => {
  // Inject a synthetic tree: seeding 100,000 entries into the test servers would take minutes.
  await page.evaluate(() => {
    type Store = {
      getState: () => Record<string, unknown>
      setState: (state: Record<string, unknown>) => void
    }
    const treeStore = window.__stores!['tree'] as Store
    const connections = window.__stores!['connections'] as Store
    const active = (connections.getState()['activeProfileId'] as string) ?? ''
    const state = (connections.getState()['states'] as Record<string, { connectionId: string }>)[active]!
    const base = {
      objectClasses: ['top'],
      queued: false,
      incomplete: false,
      error: undefined,
      loading: false,
    }
    const rootKey = 'dc=synthetic'
    const nodes: Record<string, unknown> = {}
    const childKeys: string[] = []
    for (let i = 0; i < 100_000; i++) {
      const key = `cn=user${i},dc=synthetic`
      childKeys.push(key)
      nodes[key] = {
        ...base,
        key,
        dn: key,
        rdn: `cn=user${i}`,
        parentKey: rootKey,
        depth: 1,
        hasChildren: false,
        expanded: false,
        childKeys: undefined,
      }
    }
    nodes[rootKey] = {
      ...base,
      key: rootKey,
      dn: rootKey,
      rdn: rootKey,
      parentKey: undefined,
      depth: 0,
      hasChildren: true,
      expanded: true,
      childKeys,
    }
    treeStore.setState({
      trees: {
        ...(treeStore.getState()['trees'] as object),
        [state.connectionId]: { nodes, rootKeys: [rootKey] },
      },
      selected: { [state.connectionId]: rootKey },
    })
  })
  await expect(item('cn=user0')).toBeVisible()

  // Scroll through the list in 20 jumps and measure how long each frame takes to render.
  const frameTimes = await page.evaluate(async () => {
    const scroller = document.querySelector('[role="tree"]') as HTMLElement
    const times: number[] = []
    for (let step = 1; step <= 20; step++) {
      const started = performance.now()
      scroller.scrollTop = (scroller.scrollHeight * step) / 20
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      times.push(performance.now() - started)
    }
    return times
  })
  expect(Math.max(...frameTimes)).toBeLessThan(100)

  // Arrow keys from the top: each step must update the selection promptly. Scroll back first:
  // rows far from the visible area are not rendered.
  await page.evaluate(() => {
    ;(document.querySelector('[role="tree"]') as HTMLElement).scrollTop = 0
  })
  await item('dc=synthetic').click()
  await tree().focus()
  const started = Date.now()
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('ArrowDown')
  }
  await expect(item('cn=user29')).toHaveAttribute('aria-selected', 'true')
  expect((Date.now() - started) / 30).toBeLessThan(60)
})

test.describe('tree filter', () => {
  const filtered = () => page.getByRole('tree', { name: 'Filtered directory tree' })
  const filteredItem = (name: string) => filtered().getByRole('treeitem', { name, exact: true })
  const filterForm = () => page.getByRole('form', { name: 'Filter the tree' })
  const status = () => page.getByRole('region', { name: 'Directory' }).getByRole('status')

  async function filterBy(attribute: string, operator: string, value: string): Promise<void> {
    await filterForm().getByLabel('Filter attribute').fill(attribute)
    // Enter moves on to the value, closing the suggestions.
    await filterForm().getByLabel('Filter attribute').press('Enter')
    await expect(filterForm().getByLabel('Filter value')).toBeFocused()
    await filterForm().getByLabel('Filter operator').selectOption({ label: operator })
    if (value !== '') {
      await filterForm().getByLabel('Filter value').fill(value)
    }
    await filterForm().getByRole('button', { name: 'Filter' }).click()
  }

  test('finds entries by name below the selected entry and shows the path to them', async () => {
    await item('dc=example,dc=com').click()
    await filterBy('', 'contains', 'jdoe')
    await expect(status()).toHaveText('1 match below dc=example,dc=com.')
    await expect(filtered().getByRole('treeitem')).toHaveText(['dc=example,dc=com', 'ou=people', 'uid=jdoe'])
    await expect(filteredItem('uid=jdoe')).toHaveAttribute('data-match', 'true')
    await expect(filteredItem('ou=people')).toHaveAttribute('data-match', 'false')

    await filteredItem('uid=jdoe').click()
    await expect(
      page.getByRole('region', { name: 'Entry' }).getByRole('heading', { name: 'jdoe' }),
    ).toBeVisible()
    await expect(filteredItem('uid=jdoe')).toHaveAttribute('aria-selected', 'true')

    // Clearing brings the tree back, opened to the entry that was picked.
    await page.getByRole('button', { name: 'Clear filter' }).click()
    await expect(filtered()).toHaveCount(0)
    await expect(item('uid=jdoe')).toHaveAttribute('aria-selected', 'true')
    await expect(item('ou=groups')).toBeVisible()
  })

  test('searches entries that were never loaded, by attribute', async () => {
    await item('dc=example,dc=com').click()
    await filterBy('sn', 'equals', 'Bulk 04242')
    await expect(filtered().getByRole('treeitem')).toHaveText([
      'dc=example,dc=com',
      'ou=bulk',
      'cn=user04242',
    ])
  })

  test('searches only the children when the subtree is not included', async () => {
    await item('dc=example,dc=com').click()
    await filterForm().getByLabel('Whole subtree').uncheck()
    await filterBy('uid', 'equals', 'jdoe')
    await expect(status()).toHaveText('No entries match directly below dc=example,dc=com.')
    await filterBy('ou', 'starts with', 'peo')
    await expect(filtered().getByRole('treeitem')).toHaveText(['dc=example,dc=com', 'ou=people'])
  })

  test('needs no value for "exists" and stops at the size limit', async () => {
    await item('dc=example,dc=com').click()
    await filterForm().getByLabel('Filter operator').selectOption({ label: 'exists' })
    await expect(filterForm().getByLabel('Filter value')).toBeDisabled()
    await filterForm().getByLabel('Filter attribute').fill('cn')
    await filterForm().getByLabel('Filter attribute').press('Tab')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await filterForm().getByRole('button', { name: 'Filter' }).click()
    await expect(status()).toHaveText(
      'Showing the first 1,000 matches below dc=example,dc=com. Narrow the filter to see the rest.',
    )
  })
})

test.describe('refresh and Copy DN (task 9.3)', () => {
  test('copies a DN from the context menu and with Cmd/Ctrl+C', async () => {
    const readClipboard = () => launched.app.evaluate(({ clipboard }) => clipboard.readText())
    await tree().getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
    await item('ou=people').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy DN' }).click()
    await expect.poll(readClipboard).toBe('ou=people,dc=example,dc=com')

    await item('ou=groups').click()
    await tree().focus()
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(readClipboard).toBe('ou=groups,dc=example,dc=com')
  })

  test('shows an entry added by another client after a refresh, keeping expanded nodes open', async () => {
    const name = `e2e-${randomUUID().slice(0, 8)}`
    const dn = `cn=${name},ou=people,dc=example,dc=com`
    const admin = new Client({ url: `ldap://${OPENLDAP.host}:${OPENLDAP.port}` })
    await admin.bind(OPENLDAP.adminDn, OPENLDAP.adminPassword)
    try {
      await tree().getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
      await tree().getByRole('button', { name: 'Expand ou=people' }).click()
      await tree().getByRole('button', { name: 'Expand ou=groups' }).click()
      await expect(item('uid=jdoe')).toBeVisible()
      await expect(item(`cn=${name}`)).toHaveCount(0)

      await admin.add(dn, { objectClass: ['top', 'person'], cn: name, sn: 'Added elsewhere' })

      await item('dc=example,dc=com').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Refresh' }).click()
      await expect(item(`cn=${name}`)).toBeVisible()
      await expect(item('ou=groups')).toHaveAttribute('aria-expanded', 'true')
      await expect(item('cn=admins')).toBeVisible()
    } finally {
      await admin.del(dn).catch(() => undefined)
      await admin.unbind()
    }
  })
})

test.describe('DN lookup (task 9.4)', () => {
  const lookup = () => page.getByRole('dialog', { name: 'Go to DN' }).getByLabel('Go to DN')
  const openLookup = () => page.keyboard.press('ControlOrMeta+l')

  test('jumps to a deep entry, expanding and loading its ancestors', async () => {
    await openLookup()
    await lookup().fill('cn=user04711, ou=Bulk, dc=example, dc=com')
    await lookup().press('Enter')
    await expect(item('cn=user04711')).toHaveAttribute('aria-selected', 'true')
    // Level 3 means the root and ou=bulk were expanded to reach it. (Those rows are scrolled
    // out of view, and rows out of view are not rendered.)
    await expect(item('cn=user04711')).toHaveAttribute('aria-level', '3')
    await expect(tree()).toBeFocused()
  })

  test('names the closest existing ancestor of a missing DN and goes there', async () => {
    await openLookup()
    await lookup().fill('uid=nobody,ou=people,dc=example,dc=com')
    await lookup().press('Enter')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('No entry with this DN exists.')
    await expect(alert).toContainText('ou=people,dc=example,dc=com')
    await alert.getByRole('button', { name: 'Go there' }).click()
    await expect(item('ou=people')).toHaveAttribute('aria-selected', 'true')
  })

  test('rejects invalid DN syntax without asking the server', async () => {
    const operations = () =>
      page.evaluate(async () => {
        const log = (window.__stores ?? {})['log'] as { getState: () => { records: unknown[] } } | undefined
        return log?.getState().records.length ?? -1
      })
    const before = await operations()
    await openLookup()
    await lookup().fill('cn=jdoe,,dc=example')
    await lookup().press('Enter')
    await expect(page.getByRole('alert')).toContainText('This is not a valid DN')
    await expect(lookup()).toHaveAttribute('aria-invalid', 'true')
    expect(await operations()).toBe(before)
  })

  test('opens with Cmd/Ctrl+L and from the command palette', async () => {
    await item('dc=example,dc=com').click()
    await openLookup()
    await expect(lookup()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(tree()).toBeFocused()

    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('go to')
    await page.keyboard.press('Enter')
    await expect(lookup()).toBeFocused()
  })
})

test.describe('connection loss (task 9.5)', () => {
  test('keeps the loaded tree visible but read-only, and reconnects to a fresh tree', async () => {
    // Connect through a proxy that the test can cut, as a crashed server or broken network would.
    const proxy = await startTcpProxy(OPENLDAP.host, OPENLDAP.port)
    try {
      await page.evaluate(
        async ({ port, reader }) => {
          await window.api.invoke('profiles.save', {
            name: 'Proxied',
            host: '127.0.0.1',
            port,
            security: 'none',
            bindDn: reader.dn,
            baseDn: '',
            caCertificates: [],
            password: { action: 'set', value: reader.password },
          })
        },
        { port: proxy.port, reader: READER },
      )
      launched = await relaunch(launched)
      page = launched.window
      const row = page.getByRole('listitem', { name: 'Proxied' })
      await row.getByRole('button', { name: 'Connect' }).click()
      await expect(row).toHaveAttribute('data-status', 'connected')
      await tree().getByRole('button', { name: 'Expand dc=example,dc=com' }).click()
      await tree().getByRole('button', { name: 'Expand ou=people' }).click()
      await expect(item('uid=jdoe')).toBeVisible()
      await item('uid=jdoe').click()
      const editor = page.getByRole('region', { name: 'Entry' })
      // The reader may not change jdoe, but the editor still offers inputs while connected.
      await expect(editor.getByLabel('cn value', { exact: true })).toBeVisible()

      proxy.dropAll()

      await expect(row).toHaveAttribute('data-status', 'error')
      await expect(row).toContainText('The connection to the server was lost.')
      await expect(page.getByRole('region', { name: 'Directory' })).toContainText(
        'cannot be changed until you reconnect',
      )
      await expect(item('uid=jdoe')).toBeVisible()
      await expect(tree()).toHaveAttribute('aria-readonly', 'true')
      await expect(editor).toContainText('This entry cannot be changed until you reconnect.')
      await expect(editor.getByLabel('cn value', { exact: true })).toHaveCount(0)
      await expect(editor.getByRole('button', { name: 'Add attribute' })).toHaveCount(0)

      // Nothing new can be loaded, and Refresh is unavailable.
      await tree().getByRole('button', { name: 'Expand ou=groups' }).click()
      await expect(item('ou=groups')).toHaveAttribute('aria-expanded', 'false')
      await item('ou=people').click({ button: 'right' })
      await expect(page.getByRole('menuitem', { name: 'Refresh' })).toBeDisabled()
      await page.keyboard.press('Escape')
      // Loaded nodes can still be closed and opened again.
      await tree().getByRole('button', { name: 'Collapse ou=people' }).click()
      await tree().getByRole('button', { name: 'Expand ou=people' }).click()
      await expect(item('uid=jdoe')).toBeVisible()

      await row.getByRole('button', { name: 'Reconnect' }).click()
      await expect(row).toHaveAttribute('data-status', 'connected')
      await expect(page.getByRole('region', { name: 'Directory' })).not.toContainText('cannot be changed')
      await expect(item('dc=example,dc=com')).toHaveAttribute('aria-expanded', 'false')
    } finally {
      await proxy.close()
    }
  })
})
