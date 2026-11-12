import { ResultCodeError } from 'ldapts'
import type { AppError } from '@shared/ipc'
import { resultName } from '@shared/result-codes'
import { StorageError } from '../store/json-store'

/** Human-readable text for the result codes users run into most. */
const RESULT_MESSAGES: Record<number, string> = {
  4: 'The server stopped after returning the maximum number of entries.',
  11: 'The server stopped the operation because it hit an administrative limit.',
  32: 'No such entry exists.',
  34: 'The DN is not valid.',
  49: 'Invalid credentials: the bind DN or password is wrong.',
  50: 'You do not have permission to do this.',
  51: 'The server is busy. Try again.',
  52: 'The server is unavailable.',
  53: 'The server refused to do this.',
  64: 'The entry violates the naming rules of its object classes.',
  65: 'The entry violates the schema of its object classes.',
  66: 'This entry has children, so the operation is not allowed.',
  68: 'An entry with this DN already exists.',
  122: 'The entry was changed on the server since it was loaded.',
}

/** Error codes Node uses for connection-level failures. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
])

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return undefined
}

/** ldapts puts the server's diagnostic message after the class name, e.g. "Code: 0x31". */
function diagnosticOf(error: ResultCodeError): string | undefined {
  const message = error.message.replace(/(\s*Code: 0x[0-9a-f]+)+\s*$/i, '').trim()
  return message === '' ? undefined : message
}

/** Carries an error that is already in the renderer's shape, e.g. a failed connect. */
export class AppErrorException extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
  }
}

/** The session lost its connection (or was closed); it refuses operations until reconnected. */
export class NotConnectedError extends Error {
  constructor(message = 'The connection to the server was lost. Reconnect to continue.') {
    super(message)
  }
}

/** Converts anything thrown by ldapts or Node into the error shape the renderer understands. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppErrorException) {
    return error.appError
  }
  if (error instanceof NotConnectedError) {
    return { kind: 'notConnected', message: error.message }
  }
  if (error instanceof StorageError) {
    return { kind: 'storage', message: error.message }
  }
  if (error instanceof ResultCodeError) {
    const diagnostic = diagnosticOf(error)
    const result: AppError = {
      kind: 'ldap',
      resultCode: error.code,
      resultName: resultName(error.code),
      message: RESULT_MESSAGES[error.code] ?? diagnostic ?? `The server returned ${resultName(error.code)}.`,
    }
    if (diagnostic) {
      result.diagnostic = diagnostic
    }
    return result
  }
  const code = errorCode(error)
  const message = error instanceof Error ? error.message : String(error)
  if (
    (code && NETWORK_CODES.has(code)) ||
    /connection timeout|socket (error|closed)|connection closed/i.test(message)
  ) {
    return { kind: 'network', message: networkMessage(code, message) }
  }
  if (code?.startsWith('ERR_SSL') || code?.startsWith('ERR_TLS') || /ssl|tls|handshake/i.test(message)) {
    return { kind: 'tls', message: `TLS connection failed: ${message}` }
  }
  return { kind: 'network', message }
}

function networkMessage(code: string | undefined, message: string): string {
  switch (code) {
    case 'ECONNREFUSED':
      return 'Connection refused: nothing is listening on that host and port.'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The host name could not be resolved.'
    case 'ETIMEDOUT':
      return 'The connection timed out.'
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'The host is unreachable.'
    default:
      return /connection timeout/i.test(message)
        ? 'The connection timed out.'
        : `Connection failed: ${message}`
  }
}

/** Result codes that end a search with partial results instead of failing it. */
export function isLimitResult(error: unknown): boolean {
  return error instanceof ResultCodeError && (error.code === 4 || error.code === 11)
}

export { resultName }
