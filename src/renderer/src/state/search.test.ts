import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearch } from './search'

type Listener = (event: Record<string, unknown>) => void

/** A stand-in for window.api that lets the test push stream events. */
function fakeApi() {
  const streams: { push: Listener; cancelled: boolean; started: () => void }[] = []
  let hold = false
  const api = {
    invoke: vi.fn(),
    stream: vi.fn(async (_name: string, _request: unknown, onEvent: Listener) => {
      const entry: (typeof streams)[number] = { push: onEvent, cancelled: false, started: () => {} }
      streams.push(entry)
      if (hold) {
        await new Promise<void>((resolve) => {
          entry.started = resolve
        })
      }
      return {
        operationId: `op${streams.length}`,
        cancel: () => {
          entry.cancelled = true
        },
      }
    }),
  }
  return { api, streams, holdStart: () => (hold = true) }
}

const entry = (dn: string) => ({ dn, attributes: {} })
const page = (...dns: string[]) => ({ kind: 'page', data: { entries: dns.map(entry) } })
const progress = { kind: 'progress', data: { loaded: 1 } }
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let fake: ReturnType<typeof fakeApi>

beforeEach(() => {
  fake = fakeApi()
  vi.stubGlobal('window', { api: fake.api })
  useSearch.setState({
    params: { base: 'dc=example,dc=com', scope: 'sub', filter: '(cn=*)', attributes: '', sizeLimit: '1000' },
    results: [],
    status: { state: 'idle' },
  })
})

describe('search store', () => {
  it('collects pages and finishes', async () => {
    await useSearch.getState().run('c1')
    fake.streams[0]!.push(page('cn=a'))
    fake.streams[0]!.push(page('cn=b'))
    fake.streams[0]!.push({ kind: 'done', data: { incomplete: false, sizeLimitReached: false } })
    expect(useSearch.getState().results.map((result) => result.dn)).toEqual(['cn=a', 'cn=b'])
    expect(useSearch.getState().status).toEqual({ state: 'done', incomplete: false, sizeLimitReached: false })
  })

  it('shows "stopped" at once and ignores whatever the server still sends', async () => {
    await useSearch.getState().run('c1')
    fake.streams[0]!.push(page('cn=a'))
    useSearch.getState().stop()
    expect(fake.streams[0]!.cancelled).toBe(true)
    fake.streams[0]!.push(progress)
    fake.streams[0]!.push(page('cn=b'))
    fake.streams[0]!.push({ kind: 'done', data: { incomplete: true, sizeLimitReached: false } })
    expect(useSearch.getState().status).toEqual({ state: 'stopped' })
    expect(useSearch.getState().results.map((result) => result.dn)).toEqual(['cn=a'])
  })

  it('cancels a search stopped while it was still starting', async () => {
    fake.holdStart()
    const running = useSearch.getState().run('c1')
    await flush()
    useSearch.getState().stop()
    fake.streams[0]!.started()
    await running
    expect(fake.streams[0]!.cancelled).toBe(true)
    expect(useSearch.getState().status).toEqual({ state: 'stopped' })
  })

  it('keeps late events of a replaced search out of the new one', async () => {
    await useSearch.getState().run('c1')
    await useSearch.getState().run('c1')
    expect(fake.streams[0]!.cancelled).toBe(true)
    fake.streams[0]!.push(page('cn=old'))
    fake.streams[1]!.push(page('cn=new'))
    expect(useSearch.getState().results.map((result) => result.dn)).toEqual(['cn=new'])
  })
})
