/** App settings shared by main (storage) and the renderer (layout, theme). */
import { z } from 'zod'

export const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  /**
   * Sizes of the fixed panes in pixels, by panel id (sidebar width, connections and bottom panel
   * heights). They keep their size when the window is resized; the other panes take up the rest.
   */
  paneSizes: z.record(z.string(), z.number().positive()),
  bottomPanelCollapsed: z.boolean(),
  windowBounds: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      maximized: z.boolean(),
    })
    .optional(),
})
export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  paneSizes: {},
  bottomPanelCollapsed: false,
}
