/** Restores and remembers the main window's position and size (app-shell spec: panes persist). */
import type { BrowserWindow, Rectangle } from 'electron'
import type { Settings } from '@shared/settings'
import type { SettingsStore } from '../store/settings'

type Bounds = NonNullable<Settings['windowBounds']>

const MIN_VISIBLE = 100

/**
 * Saved bounds if at least 100×100 px of them is still on a connected display, so a window
 * last shown on a now-disconnected monitor does not open off-screen.
 */
export function restorableBounds(saved: Bounds | undefined, workAreas: Rectangle[]): Bounds | undefined {
  if (!saved) {
    return undefined
  }
  const visible = workAreas.some((area) => {
    const width = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x)
    const height = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y)
    return width >= MIN_VISIBLE && height >= MIN_VISIBLE
  })
  return visible ? saved : undefined
}

/** Saves the window's normal (unmaximized) bounds and maximized state after it moves or resizes. */
export function trackWindowState(window: BrowserWindow, settings: SettingsStore): void {
  let timer: NodeJS.Timeout | undefined
  const save = () => {
    if (window.isDestroyed() || window.isMinimized()) {
      return
    }
    const bounds = window.getNormalBounds()
    void settings.update({ windowBounds: { ...bounds, maximized: window.isMaximized() } })
  }
  const saveSoon = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) {
    window.on(event as 'resize', saveSoon)
  }
  window.on('close', () => {
    clearTimeout(timer)
    save()
  })
}
