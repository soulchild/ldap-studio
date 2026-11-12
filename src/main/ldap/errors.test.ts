import {
  AdminLimitExceededError,
  InsufficientAccessError,
  InvalidCredentialsError,
  NoSuchObjectError,
  SizeLimitExceededError,
} from 'ldapts'
import { describe, expect, it } from 'vitest'
import { StorageError } from '../store/json-store'
import { isLimitResult, NotConnectedError, resultName, toAppError } from './errors'

function nodeError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code })
}

describe('toAppError', () => {
  it('maps LDAP result codes with name, friendly message and diagnostic', () => {
    expect(toAppError(new InvalidCredentialsError(''))).toEqual({
      kind: 'ldap',
      resultCode: 49,
      resultName: 'invalidCredentials',
      message: 'Invalid credentials: the bind DN or password is wrong.',
    })
    expect(toAppError(new NoSuchObjectError('no such base'))).toMatchObject({
      kind: 'ldap',
      resultCode: 32,
      resultName: 'noSuchObject',
      diagnostic: 'no such base',
    })
    expect(toAppError(new InsufficientAccessError(''))).toMatchObject({
      resultName: 'insufficientAccessRights',
    })
  })

  it('maps connection failures to network errors', () => {
    expect(toAppError(nodeError('ECONNREFUSED'))).toEqual({
      kind: 'network',
      message: 'Connection refused: nothing is listening on that host and port.',
    })
    expect(toAppError(nodeError('ENOTFOUND'))).toMatchObject({
      kind: 'network',
      message: expect.stringContaining('resolved'),
    })
    expect(toAppError(new Error('Connection timeout'))).toEqual({
      kind: 'network',
      message: 'The connection timed out.',
    })
  })

  it('maps app-level errors to their kinds', () => {
    expect(toAppError(new StorageError('disk full'))).toEqual({ kind: 'storage', message: 'disk full' })
    expect(toAppError(new NotConnectedError())).toMatchObject({ kind: 'notConnected' })
  })

  it('maps TLS failures to tls errors', () => {
    expect(toAppError(nodeError('ERR_SSL_WRONG_VERSION_NUMBER', 'wrong version number'))).toMatchObject({
      kind: 'tls',
    })
  })
})

describe('result helpers', () => {
  it('names known and unknown codes', () => {
    expect(resultName(122)).toBe('assertionFailed')
    expect(resultName(999)).toBe('resultCode999')
  })

  it('treats size and admin limits as partial results', () => {
    expect(isLimitResult(new SizeLimitExceededError(''))).toBe(true)
    expect(isLimitResult(new AdminLimitExceededError(''))).toBe(true)
    expect(isLimitResult(new NoSuchObjectError(''))).toBe(false)
    expect(isLimitResult(new Error('x'))).toBe(false)
  })
})
