/** In-memory stand-ins for Electron's ipcMain and webContents, for tests. */
import type { IpcEventLike, IpcMainLike, SenderLike } from './router'

export class FakeSender implements SenderLike {
  readonly sent: { channel: string; payload: Record<string, unknown> }[] = []
  destroyed = false
  private onDestroyed: (() => void)[] = []

  constructor(readonly id: number) {}

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload: payload as Record<string, unknown> })
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  once(_event: 'destroyed', listener: () => void): void {
    this.onDestroyed.push(listener)
  }
  destroy(): void {
    this.destroyed = true
    this.onDestroyed.forEach((listener) => listener())
  }
  events(operationId: string) {
    return this.sent.filter((message) => message.payload.operationId === operationId).map((m) => m.payload)
  }
}

export class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<string, (event: IpcEventLike, payload: unknown) => unknown>()
  readonly listeners = new Map<string, (event: IpcEventLike, payload: unknown) => void>()

  handle(channel: string, listener: (event: IpcEventLike, payload: unknown) => unknown): void {
    this.handlers.set(channel, listener)
  }
  on(channel: string, listener: (event: IpcEventLike, payload: unknown) => void): void {
    this.listeners.set(channel, listener)
  }
  call(channel: string, sender: SenderLike, payload: unknown) {
    const handler = this.handlers.get(channel)
    if (!handler) {
      throw new Error(`no handler for ${channel}`)
    }
    return Promise.resolve(handler({ sender }, payload))
  }
  emit(channel: string, sender: SenderLike, payload: unknown) {
    this.listeners.get(channel)?.({ sender }, payload)
  }
}
