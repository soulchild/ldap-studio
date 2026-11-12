/**
 * Single-entry operations (design §11): read with change marker, add, modify with stale-entry
 * detection, modify DN, and delete. These are not paged, so they run alongside the paged queue.
 */
import {
  Attribute,
  BerWriter,
  Change,
  Control,
  EqualityFilter,
  ModifyDNRequest,
  ResultCodeError,
  StatusCodeParser,
  type Client,
} from 'ldapts'
import type { Bytes, EntryAttribute, Modification } from '@shared/entry'
import type { Entry } from '@shared/ipc'
import { decodeEntry, EveryAttribute, type IsBinary, type RawEntry } from './values'

export const ASSERTION_CONTROL_OID = '1.3.6.1.1.12'

/** Result code 122 (assertionFailed), also used when the change-marker pre-check fails. */
export class StaleEntryError extends ResultCodeError {
  constructor() {
    super(122, 'The entry was changed on the server since it was loaded.')
  }
}

/**
 * Attributes that change on every modification, in order of preference: entryCSN (OpenLDAP,
 * microsecond precision), uSNChanged (Active Directory), modifyTimestamp (everyone, seconds).
 */
const CHANGE_MARKERS = ['entryCSN', 'uSNChanged', 'modifyTimestamp']

/** RFC 4528: the operation only proceeds if the entry matches the filter. */
class AssertionControl extends Control {
  constructor(private readonly filter: EqualityFilter) {
    super(ASSERTION_CONTROL_OID, { critical: true })
  }

  protected override writeControl(writer: BerWriter): void {
    const value = new BerWriter()
    this.filter.write(value)
    writer.writeBuffer(value.buffer, 0x04)
  }
}

export interface ChangeMarker {
  attribute: string
  value: string
}

function toBuffer(value: string | Bytes): string | Buffer {
  return typeof value === 'string' ? value : Buffer.from(value)
}

function firstString(raw: RawEntry, attribute: string): string | undefined {
  const key = Object.keys(raw).find((name) => name.toLowerCase() === attribute.toLowerCase())
  const value = key === undefined ? undefined : [raw[key]].flat()[0]
  if (value === undefined) {
    return undefined
  }
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
}

/** Reads one entry, or returns null if it does not exist. */
export async function readEntry(
  client: Client,
  dn: string,
  options: { includeOperational: boolean; isBinary: IsBinary },
): Promise<Entry | null> {
  let raw: RawEntry | undefined
  try {
    const { searchEntries } = await client.search(dn, {
      scope: 'base',
      filter: '(objectClass=*)',
      attributes: options.includeOperational ? ['*', '+', ...CHANGE_MARKERS] : ['*', ...CHANGE_MARKERS],
      explicitBufferAttributes: new EveryAttribute(),
    })
    raw = searchEntries[0] as RawEntry | undefined
  } catch (error) {
    if (error instanceof ResultCodeError && error.code === 32) {
      return null
    }
    throw error
  }
  if (!raw) {
    return null
  }

  let changeMarker: ChangeMarker | undefined
  for (const attribute of CHANGE_MARKERS) {
    const value = firstString(raw, attribute)
    if (value) {
      changeMarker = { attribute, value }
      break
    }
  }

  const markerNames = new Set(CHANGE_MARKERS.map((name) => name.toLowerCase()))
  const decoded = decodeEntry(raw, options.isBinary)
  // ldapts lists requested-but-absent attributes (and "+") with no values.
  const attributes = decoded.attributes.filter(
    (attribute) =>
      attribute.values.length > 0 &&
      attribute.name !== '+' &&
      (options.includeOperational || !markerNames.has(attribute.name.toLowerCase())),
  )
  const entry: Entry = { dn: raw.dn, attributes }
  if (changeMarker) {
    entry.changeMarker = changeMarker
  }
  return entry
}

export async function addEntry(client: Client, dn: string, attributes: EntryAttribute[]): Promise<void> {
  await client.add(
    dn,
    attributes
      .filter((attribute) => attribute.values.length > 0)
      .map(
        (attribute) =>
          new Attribute({
            type: attribute.name,
            values: attribute.values.map(toBuffer) as string[] | Buffer[],
          }),
      ),
  )
}

/**
 * Applies all changes in one modify request (atomic on the server). With `assert`, the
 * modify only succeeds if the entry's change marker still has the value read at load time:
 * via the Assertion control where supported, otherwise by re-reading the marker first
 * (best effort). A stale entry fails with assertionFailed (result code 122).
 */
export async function modifyEntry(
  client: Client,
  dn: string,
  changes: Modification[],
  options: { assert?: ChangeMarker | undefined; supportsAssertion: boolean },
): Promise<void> {
  const ldapChanges = changes.map(
    (change) =>
      new Change({
        operation: change.operation,
        modification: new Attribute({
          type: change.attribute,
          values: change.values.map(toBuffer) as string[] | Buffer[],
        }),
      }),
  )
  const { assert } = options
  if (assert && options.supportsAssertion) {
    const control = new AssertionControl(
      new EqualityFilter({ attribute: assert.attribute, value: assert.value }),
    )
    await client.modify(dn, ldapChanges, control)
    return
  }
  if (assert) {
    const current = await readMarker(client, dn, assert.attribute)
    if (current !== assert.value) {
      throw new StaleEntryError()
    }
  }
  await client.modify(dn, ldapChanges)
}

async function readMarker(client: Client, dn: string, attribute: string): Promise<string | undefined> {
  const { searchEntries } = await client.search(dn, { scope: 'base', attributes: [attribute] })
  const raw = searchEntries[0] as RawEntry | undefined
  return raw ? firstString(raw, attribute) : undefined
}

/** The parts of ldapts' client that `modifyDn` needs; ldapts' own modifyDN always deletes the old RDN. */
interface ClientInternals {
  _ensureConnected(): Promise<void>
  _nextMessageId(): number
  _send(message: ModifyDNRequest): Promise<{ status: number } | undefined>
}

/**
 * Renames and/or moves an entry. Built on ldapts internals because `Client.modifyDN` cannot
 * keep the old RDN value; `entries.int.test.ts` guards this against ldapts upgrades.
 */
export async function modifyDn(
  client: Client,
  request: { dn: string; newRdn: string; deleteOldRdn: boolean; newParent?: string | undefined },
): Promise<void> {
  const internals = client as unknown as ClientInternals
  await internals._ensureConnected()
  const message = new ModifyDNRequest({
    messageId: internals._nextMessageId(),
    dn: request.dn,
    newRdn: request.newRdn,
    deleteOldRdn: request.deleteOldRdn,
    ...(request.newParent !== undefined ? { newSuperior: request.newParent } : {}),
  })
  const result = await internals._send(message)
  if (result?.status !== 0) {
    throw StatusCodeParser.parse(result as Parameters<typeof StatusCodeParser.parse>[0])
  }
}

export async function deleteEntry(client: Client, dn: string): Promise<void> {
  await client.del(dn)
}
