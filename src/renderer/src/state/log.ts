/** The operation log in the renderer: follows main's log stream for the lifetime of the window. */
import { create } from 'zustand'
import type { LogRecord } from '@shared/ipc'

export const RENDERER_LOG_CAPACITY = 5000

interface LogState {
  records: LogRecord[]
  following: boolean
  follow: () => Promise<void>
}

export const useLog = create<LogState>((set, get) => ({
  records: [],
  following: false,

  async follow() {
    if (get().following) {
      return
    }
    set({ following: true })
    try {
      await window.api.stream('log.follow', {}, (event) => {
        if (event.kind !== 'page') {
          return
        }
        const merged = [...get().records, ...event.data.records]
        set({
          records: merged.length > RENDERER_LOG_CAPACITY ? merged.slice(-RENDERER_LOG_CAPACITY) : merged,
        })
      })
    } catch {
      set({ following: false })
    }
  },
}))
