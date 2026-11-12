/** Sizes of the fixed panes until the user resizes them, in pixels by panel id. */
export const DEFAULT_PANE_SIZES: Record<string, number> = {
  sidebar: 300,
  connections: 240,
  // Room for the search form plus a few result rows.
  bottom: 320,
}

/** Height of the bottom panel's tab bar, which stays visible when the panel is collapsed. */
export const BOTTOM_BAR_HEIGHT = 36
