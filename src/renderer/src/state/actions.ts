/** Which entry action dialog is open (entry-editing spec: create, copy, rename, move, delete). */
import { create } from 'zustand'

export type EntryAction = 'create' | 'copy' | 'rename' | 'move' | 'delete' | 'reload'

export interface ActionRequest {
  kind: EntryAction
  connectionId: string
  dn: string
  /** For a move started by drag and drop: the parent it was dropped on. */
  newParent?: string
}

interface ActionsStore {
  request: ActionRequest | undefined
  start: (request: ActionRequest) => void
  close: () => void
}

export const useEntryActions = create<ActionsStore>((set) => ({
  request: undefined,
  start: (request) => set({ request }),
  close: () => set({ request: undefined }),
}))
