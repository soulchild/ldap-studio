import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import { CancelledError } from '../ldap/paged'
import { FakeIpcMain, FakeSender } from './fakes'
import { IpcRouter } from './router'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const app = new FakeSender(1)
const otherWindow = new FakeSender(2)

function setup() {
  const ipc = new FakeIpcMain()
  const router = new IpcRouter(ipc, (sender) => sender.id === app.id)
  return { ipc, router }
}

describe('IpcRouter invoke', () => {
  it('passes validated requests to the handler and wraps the result', async () => {
    const { ipc, router } = setup()
    router.invoke('connection.disconnect', async (request) => {
      expect(request).toEqual({ connectionId: 'c1' })
      return null
    })
    expect(await ipc.call(IPC_CHANNELS.invoke('connection.disconnect'), app, { connectionId: 'c1' })).toEqual(
      {
        ok: true,
        value: null,
      },
    )
  })

  it('rejects invalid payloads before the handler runs', async () => {
    const { ipc, router } = setup()
    let called = false
    router.invoke('entry.delete', async () => {
      called = true
      return null
    })
    const result = await ipc.call(IPC_CHANNELS.invoke('entry.delete'), app, { connectionId: '', dn: 5 })
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalidRequest' } })
    expect(called).toBe(false)
  })

  it('rejects requests from other windows', async () => {
    const { ipc, router } = setup()
    router.invoke('profiles.list', async () => [])
    expect(await ipc.call(IPC_CHANNELS.invoke('profiles.list'), otherWindow, {})).toMatchObject({
      ok: false,
      error: { kind: 'invalidRequest', message: 'Request from an unknown window.' },
    })
  })

  it('returns thrown errors as values', async () => {
    const { ipc, router } = setup()
    router.invoke('profiles.list', async () => {
      throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    })
    expect(await ipc.call(IPC_CHANNELS.invoke('profiles.list'), app, {})).toMatchObject({
      ok: false,
      error: { kind: 'network' },
    })
  })
})

describe('IpcRouter streams', () => {
  const searchRequest = {
    connectionId: 'c1',
    base: 'dc=x',
    scope: 'sub',
    filter: '(objectClass=*)',
    attributes: [],
    sizeLimit: 0,
  }

  it('sends pages, progress and done to the starting window', async () => {
    const sender = new FakeSender(1)
    const ipc = new FakeIpcMain()
    const router = new IpcRouter(ipc, () => true)
    router.stream('search.run', async (_request, context) => {
      context.page({ entries: [{ dn: 'cn=a,dc=x', attributes: [] }] })
      context.progress({ loaded: 1 })
      return { incomplete: false, sizeLimitReached: false }
    })
    const started = await ipc.call(IPC_CHANNELS.streamStart('search.run'), sender, {
      operationId: 'op1',
      request: searchRequest,
    })
    expect(started).toEqual({ ok: true, value: { operationId: 'op1' } })
    await settle()
    expect(sender.events('op1').map((event) => event.kind)).toEqual(['page', 'progress', 'done'])
    expect(router.runningStreams).toBe(0)
  })

  it('rejects invalid stream requests and duplicate operation ids', async () => {
    const { ipc, router } = setup()
    router.stream('search.run', () => new Promise(() => undefined))
    const channel = IPC_CHANNELS.streamStart('search.run')
    expect(
      await ipc.call(channel, app, { operationId: 'op1', request: { ...searchRequest, filter: '' } }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'invalidRequest' },
    })
    await ipc.call(channel, app, { operationId: 'op2', request: searchRequest })
    expect(await ipc.call(channel, app, { operationId: 'op2', request: searchRequest })).toMatchObject({
      ok: false,
    })
  })

  function abortableStream(router: IpcRouter) {
    router.stream(
      'search.run',
      (_request, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new CancelledError()))
        }),
    )
  }

  it('aborts a stream when the window cancels it', async () => {
    const sender = new FakeSender(1)
    const ipc = new FakeIpcMain()
    const router = new IpcRouter(ipc, () => true)
    abortableStream(router)
    await ipc.call(IPC_CHANNELS.streamStart('search.run'), sender, {
      operationId: 'op1',
      request: searchRequest,
    })
    ipc.emit(IPC_CHANNELS.streamCancel, sender, { operationId: 'op1' })
    await settle()
    expect(sender.events('op1')).toEqual([
      { operationId: 'op1', kind: 'error', error: expect.objectContaining({ kind: 'cancelled' }) },
    ])
    expect(router.runningStreams).toBe(0)
  })

  it('ignores a cancel from a window that did not start the stream', async () => {
    const owner = new FakeSender(1)
    const stranger = new FakeSender(3)
    const ipc = new FakeIpcMain()
    const router = new IpcRouter(ipc, () => true)
    abortableStream(router)
    await ipc.call(IPC_CHANNELS.streamStart('search.run'), owner, {
      operationId: 'op1',
      request: searchRequest,
    })
    ipc.emit(IPC_CHANNELS.streamCancel, stranger, { operationId: 'op1' })
    await settle()
    expect(router.runningStreams).toBe(1)
  })

  it('aborts the streams of a connection when it is disconnected', async () => {
    const sender = new FakeSender(1)
    const ipc = new FakeIpcMain()
    const router = new IpcRouter(ipc, () => true)
    abortableStream(router)
    const channel = IPC_CHANNELS.streamStart('search.run')
    await ipc.call(channel, sender, { operationId: 'a', request: searchRequest })
    await ipc.call(channel, sender, { operationId: 'b', request: { ...searchRequest, connectionId: 'c2' } })
    router.cancelConnection('c1')
    await settle()
    expect(router.runningStreams).toBe(1)
    expect(sender.events('a').at(-1)).toMatchObject({ kind: 'error' })
    expect(sender.events('b')).toEqual([])
  })

  it('aborts the streams of a window when it closes, without sending to it', async () => {
    const sender = new FakeSender(1)
    const ipc = new FakeIpcMain()
    const router = new IpcRouter(ipc, () => true)
    abortableStream(router)
    await ipc.call(IPC_CHANNELS.streamStart('search.run'), sender, {
      operationId: 'op1',
      request: searchRequest,
    })
    sender.destroy()
    await settle()
    expect(router.runningStreams).toBe(0)
    expect(sender.sent).toEqual([])
  })
})
