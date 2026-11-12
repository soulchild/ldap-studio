/** App settings in the renderer: loaded once from main, updated optimistically, saved by main. */
import { create } from 'zustand'
import type { Settings } from '@shared/settings'

interface SettingsState {
  settings: Settings | null
  error: string | null
  load: () => Promise<void>
  update: (changes: Partial<Settings>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  error: null,

  async load() {
    const result = await window.api.invoke('settings.get', {})
    if (result.ok) {
      set({ settings: result.value, error: null })
    } else {
      set({ error: result.error.message })
    }
  },

  update(changes) {
    const current = get().settings
    if (current) {
      set({ settings: { ...current, ...changes } })
    }
    void window.api.invoke('settings.update', changes).then((result) => {
      if (!result.ok) {
        set({ error: result.error.message })
      }
    })
  },
}))
