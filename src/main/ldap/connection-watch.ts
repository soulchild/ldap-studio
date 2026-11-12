/**
 * Watches a session's one TCP connection. ldapts silently reconnects on the next operation
 * after a connection drops, without binding again and without StartTLS, so a lost session
 * would carry on as an anonymous, possibly unencrypted client. The socket factories below
 * allow exactly one connection (plus its StartTLS upgrade) and report when it closes.
 */
import net from 'node:net'
import type tls from 'node:tls'
import { NotConnectedError } from './errors'

export class ConnectionWatch {
  private connected = false
  private lost = false
  private closing = false
  private readonly listeners = new Set<() => void>()

  get isLost(): boolean {
    return this.lost
  }

  /** Called before an intentional close, so the close is not reported as a loss. */
  markClosing(): void {
    this.closing = true
  }

  onLost(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private claimConnection(): void {
    if (this.connected || this.closing) {
      throw new NotConnectedError()
    }
    this.connected = true
  }

  private watch(socket: net.Socket): void {
    socket.once('close', () => {
      if (this.closing || this.lost) {
        return
      }
      this.lost = true
      for (const listener of this.listeners) {
        listener()
      }
    })
  }

  /** For ldapts' `createConnection` (plain LDAP and StartTLS). */
  plainConnect(): typeof net.connect {
    return ((...args: unknown[]) => {
      this.claimConnection()
      const socket = (net.connect as (...connectArgs: unknown[]) => net.Socket)(...args)
      this.watch(socket)
      return socket
    }) as typeof net.connect
  }

  /** Wraps a `tls.connect` for ldapts' `createSecureConnection` (LDAPS, and StartTLS upgrades). */
  secureConnect(connect: typeof tls.connect): typeof tls.connect {
    return ((...args: unknown[]) => {
      // StartTLS passes the existing plain socket, which is already claimed and watched.
      const isUpgrade = args.some(
        (arg) => typeof arg === 'object' && arg !== null && 'socket' in arg && arg.socket !== undefined,
      )
      if (!isUpgrade) {
        this.claimConnection()
      }
      const socket = (connect as (...connectArgs: unknown[]) => tls.TLSSocket)(...args)
      if (!isUpgrade) {
        this.watch(socket)
      }
      return socket
    }) as typeof tls.connect
  }
}
