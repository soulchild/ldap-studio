import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp } from './app'
import { OPENLDAP, testServersRunning } from './ldap-env'

let launched: LaunchedApp

test.beforeAll(async () => {
  test.skip(!(await testServersRunning()), 'start the test servers with `pnpm test:env:up`')
  launched = await launchApp()
})

test.afterAll(async () => {
  await launched?.close()
})

test('the Log tab lists the bind and the search without showing the password', async () => {
  const page = launched.window
  const connectionId = await page.evaluate(async (server) => {
    const saved = await window.api.invoke('profiles.save', {
      name: 'Test OpenLDAP',
      host: server.host,
      port: server.port,
      security: 'none',
      bindDn: server.adminDn,
      baseDn: '',
      caCertificates: [],
      password: { action: 'keep' },
    })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }
    const connected = await window.api.invoke('connection.connect', {
      profileId: saved.value.id,
      password: server.adminPassword,
    })
    if (!connected.ok) {
      throw new Error(connected.error.message)
    }
    return connected.value.connectionId
  }, OPENLDAP)

  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        void window.api
          .stream(
            'search.run',
            {
              connectionId: id,
              base: 'dc=example,dc=com',
              scope: 'sub',
              filter: '(uid=jdoe)',
              attributes: ['cn'],
              sizeLimit: 5,
            },
            (event) => {
              if (event.kind === 'done') {
                resolve()
              } else if (event.kind === 'error') {
                reject(new Error(event.error.message))
              }
            },
          )
          .catch(reject)
      }),
    connectionId,
  )

  await page.getByRole('tab', { name: 'Log' }).click()
  const log = page.getByRole('table', { name: 'Operation log' })
  const bindRow = log.getByRole('row').filter({ hasText: 'Bind' })
  await expect(bindRow).toContainText(OPENLDAP.adminDn)
  await expect(bindRow).toContainText('success')
  await expect(log.getByRole('row').filter({ hasText: '(uid=jdoe)' })).toContainText('Search')
  await expect(log.getByRole('row').filter({ hasText: 'Test OpenLDAP' }).first()).toBeVisible()
  expect(await page.content()).not.toContain(OPENLDAP.adminPassword)
})
