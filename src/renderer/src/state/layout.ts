/** Lets any part of the UI show a tab of the bottom panel (e.g. the Search button). */
import { create } from 'zustand'

export type BottomTab = 'search' | 'log'

interface LayoutStore {
  bottomTab: BottomTab
  /** Bumped to ask the workspace to expand the bottom panel. */
  revealRequest: number
  setBottomTab: (tab: BottomTab) => void
  showBottomTab: (tab: BottomTab) => void
}

export const useLayout = create<LayoutStore>((set) => ({
  bottomTab: 'search',
  revealRequest: 0,
  setBottomTab: (bottomTab) => set({ bottomTab }),
  showBottomTab: (bottomTab) => set((store) => ({ bottomTab, revealRequest: store.revealRequest + 1 })),
}))
