import { describe, expect, it } from 'vitest'
import { OperationLog, summarizeChanges, summarizeValue } from './oplog'

const base = {
  connectionId: 'c1',
  profileName: 'prod',
  operation: 'bind' as const,
  dn: 'cn=admin,dc=x',
  resultCode: 0,
  message: 'Simple bind',
  durationMs: 3,
}

describe('OperationLog', () => {
  it('assigns ids and timestamps and notifies subscribers', () => {
    const log = new OperationLog()
    const seen: number[] = []
    const unsubscribe = log.subscribe((record) => seen.push(record.id))
    const first = log.record(base)
    log.record(base)
    unsubscribe()
    log.record(base)
    expect(first.id).toBe(1)
    expect(Date.parse(first.timestamp)).not.toBeNaN()
    expect(seen).toEqual([1, 2])
  })

  it('keeps only the most recent records up to its capacity', () => {
    const log = new OperationLog(3)
    for (let i = 0; i < 5; i++) {
      log.record(base)
    }
    expect(log.entries().map((record) => record.id)).toEqual([3, 4, 5])
  })
})

describe('summarizeValue', () => {
  it('redacts password-like attributes', () => {
    expect(summarizeValue('userPassword', 'secret')).toBe('<redacted>')
    expect(summarizeValue('unicodePwd', new Uint8Array([1]))).toBe('<redacted>')
    expect(summarizeValue('sambaNTPassword', 'x')).toBe('<redacted>')
  })

  it('summarizes binary values by size and truncates long text', () => {
    expect(summarizeValue('jpegPhoto', new Uint8Array(2306))).toBe('<2306 bytes>')
    expect(summarizeValue('description', 'x'.repeat(100))).toBe(`${'x'.repeat(60)}…`)
    expect(summarizeValue('mail', 'a@x')).toBe('a@x')
  })
})

describe('summarizeChanges', () => {
  it('describes each change without passwords or raw bytes', () => {
    const message = summarizeChanges([
      { operation: 'replace', attribute: 'mail', values: ['new@x'] },
      { operation: 'replace', attribute: 'userPassword', values: ['hunter2'] },
      { operation: 'add', attribute: 'jpegPhoto', values: [new Uint8Array(10)] },
      { operation: 'delete', attribute: 'telephoneNumber', values: [] },
    ])
    expect(message).toBe(
      'replace mail: new@x; replace userPassword: <redacted>; add jpegPhoto: <10 bytes>; delete telephoneNumber',
    )
    expect(message).not.toContain('hunter2')
  })
})
