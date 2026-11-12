/**
 * The only bridge between the sandboxed renderer and main (design §3, §4). It exposes one
 * `window.api` object; the renderer gets no direct access to ipcRenderer or Node.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/channels'
import type { AppError, RendererApi, StreamName } from '@shared/ipc'

type Listener = (event: { operationId: string; kind: string }) => void
const listeners = new Map<string, Listener>()

ipcRenderer.on(IPC_CHANNELS.streamEvent, (_event, payload: { operationId: string; kind: string }) => {
  listeners.get(payload.operationId)?.(payload)
  if (payload.kind === 'done' || payload.kind === 'error') {
    listeners.delete(payload.operationId)
  }
})

const api: RendererApi = {
  invoke: (name, request) => ipcRenderer.invoke(IPC_CHANNELS.invoke(name), request),

  async stream(name: StreamName, request, onEvent) {
    // Listen before starting: main may push the first page before the start call returns.
    const operationId = crypto.randomUUID()
    listeners.set(operationId, onEvent as Listener)
    const started = (await ipcRenderer.invoke(IPC_CHANNELS.streamStart(name), { operationId, request })) as
      { ok: true } | { ok: false; error: AppError }
    if (!started.ok) {
      listeners.delete(operationId)
      throw started.error
    }
    return {
      operationId,
      cancel: () => ipcRenderer.send(IPC_CHANNELS.streamCancel, { operationId }),
    }
  },
}

contextBridge.exposeInMainWorld('api', api)

if (process.argv.includes('--ldap-studio-e2e')) {
  contextBridge.exposeInMainWorld('__e2e', true)
}
