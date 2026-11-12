/**
 * The operation log (app-shell spec: operation log; design §13). Records are built from
 * operation metadata only: bind passwords never reach it, password-like attribute values are
 * redacted, and binary values are summarized by size.
 */
import type { AttributeValue, Modification } from '@shared/entry'
import type { LogRecord } from '@shared/ipc'

export type LogInput = Omit<LogRecord, 'id' | 'timestamp'>
export type LogListener = (record: LogRecord) => void

export const DEFAULT_LOG_CAPACITY = 5000

export class OperationLog {
  private records: LogRecord[] = []
  private nextId = 1
  private readonly listeners = new Set<LogListener>()

  constructor(private readonly capacity = DEFAULT_LOG_CAPACITY) {}

  record(input: LogInput): LogRecord {
    const record: LogRecord = { id: this.nextId++, timestamp: new Date().toISOString(), ...input }
    this.records.push(record)
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity)
    }
    for (const listener of this.listeners) {
      listener(record)
    }
    return record
  }

  /** Oldest first. */
  entries(): LogRecord[] {
    return [...this.records]
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

const SECRET_ATTRIBUTE = /password|secret|pwd|pin$|unicodepwd/i
const MAX_TEXT = 60

/** A value as it may appear in the log: never raw bytes, never a password. */
export function summarizeValue(attribute: string, value: AttributeValue): string {
  if (SECRET_ATTRIBUTE.test(attribute)) {
    return '<redacted>'
  }
  if (typeof value !== 'string') {
    return `<${value.length} bytes>`
  }
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
}

export function summarizeChanges(changes: Modification[]): string {
  return changes
    .map((change) => {
      if (change.values.length === 0) {
        return `${change.operation} ${change.attribute}`
      }
      const values = change.values.map((value) => summarizeValue(change.attribute, value)).join(', ')
      return `${change.operation} ${change.attribute}: ${values}`
    })
    .join('; ')
}
