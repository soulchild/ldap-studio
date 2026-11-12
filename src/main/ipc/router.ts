/**
 * Main-process side of the IPC contract (design §4). Every request is validated against
 * `@shared/ipc` before a handler sees it, errors come back as values, and streams are
 * registered so a cancel, a disconnect or a closed window aborts them.
 */
import type { z } from 'zod'
import {
  IPC_CHANNELS,
  invokeContract,
  streamCancelSchema,
  streamContract,
  type AppError,
  type InvokeName,
  type StreamName,
} from '@shared/ipc'
import { toAppError } from '../ldap/errors'
import { CancelledError } from '../ldap/paged'

/** The parts of a webContents the router uses. */
export interface SenderLike {
  readonly id: number
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): void
}

export interface IpcEventLike {
  sender: SenderLike
}

/** The parts of Electron's ipcMain the router uses. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, payload: unknown) => unknown): void
  on(channel: string, listener: (event: IpcEventLike, payload: unknown) => void): void
}

type InvokeRequestOf<N extends InvokeName> = z.output<(typeof invokeContract)[N]['request']>
type InvokeValueOf<N extends InvokeName> = Extract<
  z.output<(typeof invokeContract)[N]['response']>,
  { ok: true }
>['value']
type StreamRequestOf<N extends StreamName> = z.output<(typeof streamContract)[N]['request']>
type StreamPart<N extends StreamName, K extends 'page' | 'progress' | 'done'> = z.output<
  (typeof streamContract)[N][K]
>

export interface InvokeContext {
  sender: SenderLike
}

export interface StreamContext<N extends StreamName> {
  sender: SenderLike
  signal: AbortSignal
  page: (data: StreamPart<N, 'page'>) => void
  progress: (data: StreamPart<N, 'progress'>) => void
}

export type InvokeHandler<N extends InvokeName> = (
  request: InvokeRequestOf<N>,
  context: InvokeContext,
) => Promise<InvokeValueOf<N>>

export type StreamHandler<N extends StreamName> = (
  request: StreamRequestOf<N>,
  context: StreamContext<N>,
) => Promise<StreamPart<N, 'done'>>

interface RunningStream {
  controller: AbortController
  senderId: number
  connectionId: string | undefined
}

function invalid(error: z.ZodError): AppError {
  const issue = error.issues[0]
  const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
  return {
    kind: 'invalidRequest',
    message: `Invalid request${where}: ${issue?.message ?? 'unknown problem'}`,
  }
}

export class IpcRouter {
  private readonly streams = new Map<string, RunningStream>()
  private readonly watchedSenders = new Set<number>()

  constructor(
    private readonly ipc: IpcMainLike,
    /** Only the app's own window may call into main. */
    private readonly isTrustedSender: (sender: SenderLike) => boolean,
  ) {
    ipc.on(IPC_CHANNELS.streamCancel, (event, payload) => {
      const parsed = streamCancelSchema.safeParse(payload)
      const running = parsed.success ? this.streams.get(parsed.data.operationId) : undefined
      if (running && running.senderId === event.sender.id) {
        running.controller.abort()
      }
    })
  }

  invoke<N extends InvokeName>(name: N, handler: InvokeHandler<N>): void {
    const contract = invokeContract[name]
    this.ipc.handle(IPC_CHANNELS.invoke(name), async (event, payload) => {
      if (!this.isTrustedSender(event.sender)) {
        return { ok: false, error: { kind: 'invalidRequest', message: 'Request from an unknown window.' } }
      }
      const parsed = contract.request.safeParse(payload)
      if (!parsed.success) {
        return { ok: false, error: invalid(parsed.error) }
      }
      try {
        const value = await handler(parsed.data as InvokeRequestOf<N>, { sender: event.sender })
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: toAppError(error) }
      }
    })
  }

  stream<N extends StreamName>(name: N, handler: StreamHandler<N>): void {
    const contract = streamContract[name]
    this.ipc.handle(IPC_CHANNELS.streamStart(name), (event, payload) => {
      const sender = event.sender
      if (!this.isTrustedSender(sender)) {
        return { ok: false, error: { kind: 'invalidRequest', message: 'Request from an unknown window.' } }
      }
      const envelope = payload as { operationId?: unknown; request?: unknown } | null
      const operationId = typeof envelope?.operationId === 'string' ? envelope.operationId : ''
      if (operationId === '' || this.streams.has(operationId)) {
        return { ok: false, error: { kind: 'invalidRequest', message: 'Invalid or duplicate operation id.' } }
      }
      const parsed = contract.request.safeParse(envelope?.request)
      if (!parsed.success) {
        return { ok: false, error: invalid(parsed.error) }
      }
      const request = parsed.data as StreamRequestOf<N>
      const connectionId =
        typeof request === 'object' && request !== null && 'connectionId' in request
          ? String((request as { connectionId: unknown }).connectionId)
          : undefined
      const controller = new AbortController()
      this.streams.set(operationId, { controller, senderId: sender.id, connectionId })
      this.watchSender(sender)

      const send = (message: Record<string, unknown>) => {
        if (!sender.isDestroyed()) {
          sender.send(IPC_CHANNELS.streamEvent, { operationId, ...message })
        }
      }
      void handler(request, {
        sender,
        signal: controller.signal,
        page: (data) => send({ kind: 'page', data }),
        progress: (data) => send({ kind: 'progress', data }),
      })
        .then((data) => send({ kind: 'done', data }))
        .catch((error: unknown) =>
          send({
            kind: 'error',
            error:
              error instanceof CancelledError
                ? { kind: 'cancelled', message: error.message }
                : toAppError(error),
          }),
        )
        .finally(() => this.streams.delete(operationId))
      return { ok: true, value: { operationId } }
    })
  }

  /** Aborts the streams of a connection, e.g. when it is disconnected or lost. */
  cancelConnection(connectionId: string): void {
    for (const running of this.streams.values()) {
      if (running.connectionId === connectionId) {
        running.controller.abort()
      }
    }
  }

  get runningStreams(): number {
    return this.streams.size
  }

  private watchSender(sender: SenderLike): void {
    if (this.watchedSenders.has(sender.id)) {
      return
    }
    this.watchedSenders.add(sender.id)
    sender.once('destroyed', () => {
      this.watchedSenders.delete(sender.id)
      for (const running of this.streams.values()) {
        if (running.senderId === sender.id) {
          running.controller.abort()
        }
      }
    })
  }
}
