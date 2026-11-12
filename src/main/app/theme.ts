/** Light, dark and system themes (app-shell spec). Main owns the choice; the renderer follows it. */
import { nativeTheme } from 'electron'
import type { Settings } from '@shared/settings'

export type ThemeMode = Settings['theme']

/** Background colours from the design tokens, used before the page has rendered. */
const BACKGROUND = { light: '#f6f7f9', dark: '#15161a' }

/**
 * Sets the theme for native UI (menus, scrollbars, dialogs) and for the renderer's
 * `prefers-color-scheme`, which the page follows. In system mode both track the OS live.
 */
export function applyTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light
}
