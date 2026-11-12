import { describe, expect, it } from 'vitest'
import { CancelledError, PagedQueue } from './paged'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('PagedQueue', () => {
  it('runs tasks one at a time in FIFO order', async () => {
    const queue = new PagedQueue()
    const order: string[] = []
    let concurrent = 0
    let maxConcurrent = 0
    const task = (name: string) => async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      order.push(`start ${name}`)
      await tick()
      order.push(`end ${name}`)
      concurrent--
      return name
    }
    const results = await Promise.all([queue.run(task('a')), queue.run(task('b')), queue.run(task('c'))])
    expect(results).toEqual(['a', 'b', 'c'])
    expect(maxConcurrent).toBe(1)
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('tells a caller when its task has to wait', async () => {
    const queue = new PagedQueue()
    const first = deferred()
    const queued: string[] = []
    const a = queue.run(() => first.promise, { onQueued: () => queued.push('a') })
    const b = queue.run(async () => undefined, { onQueued: () => queued.push('b') })
    expect(queued).toEqual(['b'])
    first.resolve()
    await Promise.all([a, b])
  })

  it('never starts a task cancelled while queued, and keeps the queue moving', async () => {
    const queue = new PagedQueue()
    const first = deferred()
    const controller = new AbortController()
    const ran: string[] = []
    const a = queue.run(async () => {
      await first.promise
      ran.push('a')
    })
    const b = queue.run(async () => ran.push('b'), { signal: controller.signal })
    const c = queue.run(async () => ran.push('c'))
    expect(queue.pending).toBe(2)
    controller.abort()
    await expect(b).rejects.toBeInstanceOf(CancelledError)
    expect(queue.pending).toBe(1)
    first.resolve()
    await Promise.all([a, c])
    expect(ran).toEqual(['a', 'c'])
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new PagedQueue().run(async () => 1, { signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    )
  })

  it('releases the queue when a task fails', async () => {
    const queue = new PagedQueue()
    await expect(queue.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(queue.run(async () => 'next')).resolves.toBe('next')
  })
})
