/** Each open connection's schema, for synchronous lookups in the editor and search (design §8). */
import { create } from 'zustand'
import { SchemaModel } from '@shared/schema-model'

export interface ConnectionSchema {
  model: SchemaModel
  available: boolean
  /** Why schema assistance is off, when it is. */
  reason: string | undefined
}

const EMPTY = new SchemaModel({ attributeTypes: [], objectClasses: [], syntaxes: [] })
export const NO_SCHEMA: ConnectionSchema = { model: EMPTY, available: false, reason: undefined }

interface SchemaStore {
  schemas: Record<string, ConnectionSchema>
  load: (connectionId: string) => Promise<void>
  drop: (connectionId: string) => void
}

export const useSchema = create<SchemaStore>((set) => ({
  schemas: {},

  async load(connectionId) {
    const result = await window.api.invoke('schema.get', { connectionId })
    if (!result.ok) {
      return
    }
    const { snapshot, available, reason } = result.value
    set((store) => ({
      schemas: { ...store.schemas, [connectionId]: { model: new SchemaModel(snapshot), available, reason } },
    }))
  },

  drop(connectionId) {
    set((store) => {
      const { [connectionId]: _dropped, ...schemas } = store.schemas
      return { schemas }
    })
  },
}))
