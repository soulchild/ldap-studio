/**
 * A minimal TCP server that answers every LDAP request with an ExtendedResponse carrying
 * `unavailable`. Used to test that a refused StartTLS closes the connection instead of
 * continuing in plain text. It records whether any further request arrived after the refusal.
 */
import { createServer, type AddressInfo, type Server } from 'node:net'

export interface FakeLdapServer {
  port: number
  /** Number of LDAP messages received; a client that stops after the refusal sends exactly one. */
  messagesReceived: () => number
  close: () => Promise<void>
}

/** Reads the message ID from an LDAPMessage: SEQUENCE { INTEGER messageID, ... }. */
function messageId(data: Buffer): number {
  let offset = 1
  const lengthByte = data[offset] ?? 0
  offset += lengthByte & 0x80 ? 1 + (lengthByte & 0x7f) : 1
  if (data[offset] !== 0x02) {
    return 0
  }
  const length = data[offset + 1] ?? 0
  let id = 0
  for (let i = 0; i < length; i++) {
    id = id * 256 + (data[offset + 2 + i] ?? 0)
  }
  return id
}

function unavailableResponse(id: number): Buffer {
  const diagnostic = Buffer.from('StartTLS not supported here')
  const op = Buffer.concat([
    Buffer.from([0x0a, 0x01, 52]),
    Buffer.from([0x04, 0x00]),
    Buffer.from([0x04, diagnostic.length]),
    diagnostic,
  ])
  const extendedResponse = Buffer.concat([Buffer.from([0x78, op.length]), op])
  const body = Buffer.concat([Buffer.from([0x02, 0x01, id]), extendedResponse])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

export async function startStartTlsRefusingServer(): Promise<FakeLdapServer> {
  let received = 0
  const server: Server = createServer((socket) => {
    socket.on('data', (data) => {
      received++
      // No encoding is set on the socket, so data always arrives as a Buffer.
      socket.write(unavailableResponse(messageId(Buffer.from(data))))
    })
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    messagesReceived: () => received,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
