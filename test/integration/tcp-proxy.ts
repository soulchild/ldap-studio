/**
 * A TCP proxy in front of a test server, used to simulate a dropped connection or a slow server
 * without touching the shared Docker containers. Counts the connections it has accepted.
 */
import { connect, createServer, type AddressInfo, type Socket } from 'node:net'

export interface TcpProxy {
  port: number
  /** Connections accepted so far. */
  connections: () => number
  /** Destroys every open connection, as a crashed server or broken network would. */
  dropAll: () => void
  /** Limits what the server sends to this many bytes per second, like a slow link (0 = no limit). */
  throttle: (bytesPerSecond: number) => void
  close: () => Promise<void>
}

export async function startTcpProxy(targetHost: string, targetPort: number): Promise<TcpProxy> {
  const sockets = new Set<Socket>()
  let accepted = 0
  let rate = 0
  const server = createServer((client) => {
    accepted++
    const upstream = connect(targetPort, targetHost)
    sockets.add(client)
    sockets.add(upstream)
    client.pipe(upstream)
    // Forward server data in order through one queue, in 1 KB slices when throttled.
    let pending = Promise.resolve()
    upstream.on('data', (chunk: Buffer) => {
      pending = pending.then(async () => {
        const slice = rate > 0 ? 1024 : chunk.length
        for (let offset = 0; offset < chunk.length && !client.destroyed; offset += slice) {
          if (rate > 0) {
            await new Promise((resolve) => setTimeout(resolve, (slice / rate) * 1000))
          }
          client.write(chunk.subarray(offset, offset + slice))
        }
      })
    })
    const cleanup = () => {
      client.destroy()
      upstream.destroy()
      sockets.delete(client)
      sockets.delete(upstream)
    }
    client.on('error', cleanup)
    upstream.on('error', cleanup)
    client.on('close', cleanup)
    upstream.on('close', cleanup)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => accepted,
    throttle: (bytesPerSecond) => {
      rate = bytesPerSecond
    },
    dropAll: () => {
      for (const socket of sockets) {
        socket.destroy()
      }
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      }),
  }
}
