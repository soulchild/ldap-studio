/**
 * Workspace-wide UI requests: which overlay is open (command palette, Go to DN, keyboard
 * shortcuts), and requests to components that own their own dialogs (save review, new
 * connection), so commands can reach them.
 */
import { create } from 'zustand'

export type Overlay = 'palette' | 'goToDn' | 'shortcuts'

interface UiStore {
  overlay: Overlay | undefined
  show: (overlay: Overlay) => void
  /** Opens the overlay, or closes it when it is already open. */
  toggle: (overlay: Overlay) => void
  close: () => void
  /** Bumped to ask the entry editor to review and save (or create) the entry. */
  saveRequest: number
  requestSave: () => void
  /** Bumped to ask the connections pane to open the new-connection dialog. */
  newConnectionRequest: number
  requestNewConnection: () => void
}

export const useUi = create<UiStore>((set) => ({
  overlay: undefined,
  show: (overlay) => set({ overlay }),
  toggle: (overlay) => set((store) => ({ overlay: store.overlay === overlay ? undefined : overlay })),
  close: () => set({ overlay: undefined }),
  saveRequest: 0,
  requestSave: () => set((store) => ({ saveRequest: store.saveRequest + 1 })),
  newConnectionRequest: 0,
  requestNewConnection: () => set((store) => ({ newConnectionRequest: store.newConnectionRequest + 1 })),
}))
