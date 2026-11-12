import { realpathSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { launchApp } from './app'

test('the app calls itself LDAP Studio, including in its About menu item', async () => {
  const launched = await launchApp()
  try {
    const info = await launched.app.evaluate(({ app, Menu }) => {
      const labels = (Menu.getApplicationMenu()?.items ?? []).flatMap((item) =>
        (item.submenu?.items ?? []).map((entry) => entry.label),
      )
      return { name: app.getName(), userData: app.getPath('userData'), labels }
    })
    expect(info.name).toBe('LDAP Studio')
    expect(info.labels).toContain('About LDAP Studio')
    expect(info.labels.join('\n')).not.toMatch(/Electron/)
    // Renaming must not move the data folder (here the one given with --user-data-dir).
    expect(realpathSync(info.userData)).toBe(realpathSync(launched.dataDirectory))
    await expect(launched.window).toHaveTitle('LDAP Studio')
  } finally {
    await launched.close()
  }
})
