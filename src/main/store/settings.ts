/** App settings in `settings.json`: theme, pane layout and window bounds (app-shell spec). */
import { join } from 'node:path'
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@shared/settings'
import { JsonStore } from './json-store'

export class SettingsStore {
  private readonly file: JsonStore<Settings>
  private cache: Settings | undefined

  constructor(dataDirectory: string) {
    this.file = new JsonStore(join(dataDirectory, 'settings.json'), {
      version: 1,
      schema: settingsSchema,
      defaults: () => structuredClone(DEFAULT_SETTINGS),
    })
  }

  async get(): Promise<Settings> {
    this.cache ??= await this.file.read()
    return structuredClone(this.cache)
  }

  /** Merges `changes` into the stored settings and saves them. */
  async update(changes: Partial<Settings>): Promise<Settings> {
    const next = settingsSchema.parse({ ...(await this.get()), ...changes })
    this.cache = next
    await this.file.write(next)
    return structuredClone(next)
  }
}

export { DEFAULT_SETTINGS, type Settings }
