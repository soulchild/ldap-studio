/// <reference types="vite/client" />
import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by the preload; the renderer's only way to reach main. */
    api: RendererApi
    /** Set only when end-to-end tests launch the app (LDAP_STUDIO_E2E=1). */
    __e2e?: boolean
    /** Renderer stores, exposed to end-to-end tests only. */
    __stores?: Record<string, unknown>
  }
}
