import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keyOf } from '@renderer/tree/model'
import { useTree } from './tree'

type Listener = (event: Record<string, unknown>) => void

/** A stand-in for window.api that lets the test push stream events. */
function fakeApi() {
  const streams: { request: { dn: string }; push: Listener; cancelled: boolean }[] = []
  const api = {
    invoke: vi.fn(),
    stream: vi.fn(async (_name: string, request: { dn: string }, onEvent: Listener) => {
      const entry = { request, push: onEvent, cancelled: false }
      streams.push(entry)
      return {
        operationId: `op${streams.length}`,
        cancel: () => {
          entry.cancelled = true
          // Main answers a cancel with the end of the stream.
          onEvent({ kind: 'done', data: { incomplete: true } })
        },
      }
    }),
  }
  return { api, streams }
}

const ROOT = 'dc=example,dc=com'
const CONNECTION = 'c1'
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const node = (dn: string, hasChildren?: boolean) => ({ dn, objectClasses: ['top'], hasChildren })
const tree = () => useTree.getState().trees[CONNECTION]!

let fake: ReturnType<typeof fakeApi>

beforeEach(() => {
  fake = fakeApi()
  vi.stubGlobal('window', { api: fake.api })
  useTree.setState({ trees: {}, selected: {} })
  useTree.getState().init(CONNECTION, [ROOT])
})

describe('tree store', () => {
  it('loads children on expand and finishes when the stream ends', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    expect(fake.streams[0]?.request.dn).toBe(ROOT)
    fake.streams[0]!.push({ kind: 'page', data: { nodes: [node(`ou=people,${ROOT}`)] } })
    expect(tree().nodes[keyOf(ROOT)]!.loading).toBe(true)
    fake.streams[0]!.push({ kind: 'done', data: { incomplete: false } })
    expect(tree().nodes[keyOf(ROOT)]).toMatchObject({
      loading: false,
      incomplete: false,
      childKeys: [keyOf(`ou=people,${ROOT}`)],
    })
  })

  it('does not load again when re-expanding a loaded node', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    fake.streams[0]!.push({ kind: 'done', data: { incomplete: false } })
    useTree.getState().collapse(CONNECTION, keyOf(ROOT))
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    expect(fake.streams).toHaveLength(1)
  })

  it('cancels loading on collapse and keeps the children loaded so far, marked incomplete', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    fake.streams[0]!.push({ kind: 'page', data: { nodes: [node(`cn=a,${ROOT}`), node(`cn=b,${ROOT}`)] } })
    useTree.getState().collapse(CONNECTION, keyOf(ROOT))
    expect(fake.streams[0]!.cancelled).toBe(true)
    expect(tree().nodes[keyOf(ROOT)]).toMatchObject({ expanded: false, loading: false, incomplete: true })
    expect(tree().nodes[keyOf(ROOT)]!.childKeys).toHaveLength(2)
  })

  it('cancels a load that is cancelled before the stream has started', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    useTree.getState().collapse(CONNECTION, keyOf(ROOT))
    await flush()
    expect(fake.streams[0]!.cancelled).toBe(true)
  })

  it('shows the queued state until the first page arrives', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    fake.streams[0]!.push({ kind: 'progress', data: { loaded: 0, queued: true } })
    expect(tree().nodes[keyOf(ROOT)]!.queued).toBe(true)
    fake.streams[0]!.push({ kind: 'page', data: { nodes: [node(`cn=a,${ROOT}`)] } })
    expect(tree().nodes[keyOf(ROOT)]!.queued).toBe(false)
  })

  it('shows a load error and loads again on retry', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    fake.streams[0]!.push({ kind: 'error', error: { kind: 'ldap', message: 'No such entry exists.' } })
    expect(tree().nodes[keyOf(ROOT)]!.error).toBe('No such entry exists.')
    useTree.getState().refresh(CONNECTION, keyOf(ROOT))
    await flush()
    expect(fake.streams).toHaveLength(2)
  })

  it('reloads on refresh and expands the previously expanded children again', async () => {
    const people = `ou=people,${ROOT}`
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    fake.streams[0]!.push({ kind: 'page', data: { nodes: [node(people), node(`ou=groups,${ROOT}`)] } })
    fake.streams[0]!.push({ kind: 'done', data: { incomplete: false } })
    useTree.getState().expand(CONNECTION, keyOf(people))
    await flush()
    fake.streams[1]!.push({ kind: 'done', data: { incomplete: false } })

    useTree.getState().refresh(CONNECTION, keyOf(ROOT))
    await flush()
    fake.streams[2]!.push({ kind: 'page', data: { nodes: [node(people), node(`ou=new,${ROOT}`)] } })
    fake.streams[2]!.push({ kind: 'done', data: { incomplete: false } })
    await flush()
    expect(fake.streams[3]?.request.dn).toBe(people)
    expect(tree().nodes[keyOf(people)]!.expanded).toBe(true)
    expect(tree().nodes[keyOf(`ou=new,${ROOT}`)]).toBeDefined()
    expect(tree().nodes[keyOf(`ou=groups,${ROOT}`)]).toBeUndefined()
  })

  it('cancels all loads of a connection when its tree is dropped', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    useTree.getState().drop(CONNECTION)
    expect(fake.streams[0]!.cancelled).toBe(true)
    expect(useTree.getState().trees[CONNECTION]).toBeUndefined()
  })

  it('ignores the late end of a load that a reload replaced', async () => {
    useTree.getState().expand(CONNECTION, keyOf(ROOT))
    await flush()
    useTree.getState().refresh(CONNECTION, keyOf(ROOT))
    await flush()
    // The first load was cancelled; the second one is still streaming.
    expect(fake.streams[0]!.cancelled).toBe(true)
    expect(tree().nodes[keyOf(ROOT)]!.loading).toBe(true)
    fake.streams[0]!.push({ kind: 'page', data: { nodes: [node(`cn=stale,${ROOT}`)] } })
    expect(tree().nodes[keyOf(`cn=stale,${ROOT}`)]).toBeUndefined()
    fake.streams[1]!.push({ kind: 'page', data: { nodes: [node(`cn=fresh,${ROOT}`)] } })
    fake.streams[1]!.push({ kind: 'done', data: { incomplete: false } })
    expect(tree().nodes[keyOf(ROOT)]).toMatchObject({ loading: false, incomplete: false })
  })
})
