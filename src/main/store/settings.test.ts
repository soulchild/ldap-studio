import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsStore } from './settings'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ldap-studio-settings-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('starts with the defaults', async () => {
    expect(await new SettingsStore(directory).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges updates and persists them across instances', async () => {
    await new SettingsStore(directory).update({
      theme: 'dark',
      paneSizes: { sidebar: 300, bottom: 240 },
    })
    const reloaded = await new SettingsStore(directory).get()
    expect(reloaded).toMatchObject({
      theme: 'dark',
      paneSizes: { sidebar: 300, bottom: 240 },
      bottomPanelCollapsed: false,
    })
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).version).toBe(1)
  })

  it('rejects invalid values instead of saving them', async () => {
    const store = new SettingsStore(directory)
    await expect(store.update({ theme: 'purple' as 'dark' })).rejects.toThrow()
    expect((await store.get()).theme).toBe('system')
  })
})
