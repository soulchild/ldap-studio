import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import { BULK_DN, TEST_SERVERS, testEnvAvailable } from '../../../test/integration/env'
import { FakeIpcMain, FakeSender } from '../ipc/fakes'
import { IpcRouter } from '../ipc/router'
import { FakeSafeStorage } from '../store/fake-safe-storage'
import { SecretBox } from '../store/secrets'
import { registerHandlers } from './handlers'
import { AppServices } from './services'

const server = TEST_SERVERS[0]
const until = async (condition: () => boolean, timeoutMs = 5000) => {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe.runIf(testEnvAvailable && server)('main-process IPC wiring (task 7.1)', () => {
  const window = new FakeSender(1)
  const ipc = new FakeIpcMain()
  let directory: string
  let services: AppServices
  let router: IpcRouter
  const invoke = (name: string, payload: unknown) => ipc.call(IPC_CHANNELS.invoke(name), window, payload)

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ldap-studio-app-'))
    router = new IpcRouter(ipc, (sender) => sender.id === window.id)
    services = new AppServices(directory, new SecretBox(new FakeSafeStorage(), 'darwin'), (id) =>
      router.cancelConnection(id),
    )
    registerHandlers(router, services)
  })

  afterAll(async () => {
    await services.disconnectAll()
    await rm(directory, { recursive: true, force: true })
  })

  async function connect(): Promise<string> {
    const saved = (await invoke('profiles.save', {
      name: 'test',
      host: server!.host,
      port: server!.ldapPort,
      security: 'none',
      bindDn: server!.adminDn,
      baseDn: '',
      caCertificates: [],
      password: { action: 'set', value: server!.adminPassword },
    })) as { ok: true; value: { id: string } }
    const connected = (await invoke('connection.connect', { profileId: saved.value.id })) as {
      ok: boolean
      value: { connectionId: string }
    }
    expect(connected.ok).toBe(true)
    return connected.value.connectionId
  }

  it('rejects an invalid payload with invalidRequest', async () => {
    expect(await invoke('entry.read', { connectionId: 'x', dn: 'cn=a' })).toMatchObject({
      ok: false,
      error: { kind: 'invalidRequest' },
    })
  })

  it('connects with a saved password and streams tree children as pages', async () => {
    const connectionId = await connect()
    await ipc.call(IPC_CHANNELS.streamStart('tree.children'), window, {
      operationId: 'tree1',
      request: { connectionId, dn: 'ou=people,dc=example,dc=com' },
    })
    await until(() => window.events('tree1').some((event) => event.kind === 'done'))
    const pages = window.events('tree1').filter((event) => event.kind === 'page')
    const nodes = pages.flatMap(
      (page) => (page.data as { nodes: { dn: string; hasChildren?: boolean }[] }).nodes,
    )
    expect(nodes.find((node) => node.dn.startsWith('uid=jdoe'))?.hasChildren).toBe(false)
  })

  it('aborts a running stream when its connection is disconnected', async () => {
    const connectionId = await connect()
    await ipc.call(IPC_CHANNELS.streamStart('tree.children'), window, {
      operationId: 'tree2',
      request: { connectionId, dn: BULK_DN },
    })
    await until(() => window.events('tree2').some((event) => event.kind === 'page'))
    await invoke('connection.disconnect', { connectionId })
    await until(() => window.events('tree2').some((event) => event.kind === 'done' || event.kind === 'error'))
    expect(router.runningStreams).toBe(0)
    const loaded = window
      .events('tree2')
      .filter((event) => event.kind === 'page')
      .flatMap((page) => (page.data as { nodes: unknown[] }).nodes).length
    expect(loaded).toBeLessThan(5000)
    expect(
      await invoke('entry.read', { connectionId, dn: 'dc=example,dc=com', includeOperational: false }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'notConnected' },
    })
  })

  it('records searches in the profile history', async () => {
    const connectionId = await connect()
    await ipc.call(IPC_CHANNELS.streamStart('search.run'), window, {
      operationId: 'search1',
      request: {
        connectionId,
        base: 'dc=example,dc=com',
        scope: 'sub',
        filter: '(uid=jdoe)',
        attributes: ['cn'],
        sizeLimit: 10,
      },
    })
    await until(() => window.events('search1').some((event) => event.kind === 'done'))
    const profileId = services.profileOf(connectionId).id
    expect((await services.history.list(profileId))[0]?.filter).toBe('(uid=jdoe)')
  })
})
