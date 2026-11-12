/**
 * Global keyboard shortcuts (app-shell spec: keyboard navigation). One table drives both the key
 * handling and the help dialog, so the two cannot drift apart.
 */
import { useEffect, useRef } from 'react'

export const isMac = navigator.platform.toLowerCase().includes('mac')

export interface Shortcut {
  /** `KeyboardEvent.key`, lower case. */
  key: string
  shift?: boolean
  description: string
}

export const SHORTCUTS = {
  dnLookup: { key: 'l', description: 'Go to a DN' },
  search: { key: 'f', description: 'Open the search' },
  save: { key: 's', description: 'Review and save the entry, or create a new one' },
  discard: { key: 'backspace', shift: true, description: 'Discard unsaved changes' },
  help: { key: '/', description: 'Show keyboard shortcuts' },
} satisfies Record<string, Shortcut>

export function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!modifier || event.altKey || event.key.toLowerCase() !== shortcut.key) {
    return false
  }
  // Some layouts need Shift to type "/" (German: Shift+7), so Shift only counts where declared.
  return shortcut.shift !== undefined || /^[a-z]$/.test(shortcut.key)
    ? event.shiftKey === (shortcut.shift ?? false)
    : true
}

const KEY_NAMES: Record<string, string> = { backspace: isMac ? '⌫' : 'Backspace' }

/** The keys to show, one per key cap: `['⌘', '⇧', '⌫']` or `['Ctrl', 'Shift', 'Backspace']`. */
export function keysOf(shortcut: Shortcut): string[] {
  const key = KEY_NAMES[shortcut.key] ?? shortcut.key.toUpperCase()
  if (isMac) {
    return ['⌘', ...(shortcut.shift ? ['⇧'] : []), key]
  }
  return ['Ctrl', ...(shortcut.shift ? ['Shift'] : []), key]
}

/** `⌘F` or `Ctrl+F`, for tooltips. */
export function shortcutText(shortcut: Shortcut): string {
  return keysOf(shortcut).join(isMac ? '' : '+')
}

/** True while a modal dialog is open; its own keys take precedence over the workspace's. */
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

/**
 * Runs `handler` when the shortcut is pressed anywhere in the window. Shortcuts are ignored while
 * a dialog is open unless `inDialogs` is set.
 */
export function useShortcut(
  shortcut: Shortcut,
  handler: () => void,
  options: { enabled?: boolean; inDialogs?: boolean } = {},
): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  const enabled = options.enabled ?? true
  const inDialogs = options.inDialogs ?? false
  useEffect(() => {
    if (!enabled) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (!matches(event, shortcut) || (!inDialogs && modalOpen())) {
        return
      }
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut, enabled, inDialogs])
}
