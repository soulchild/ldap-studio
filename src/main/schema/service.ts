/**
 * Loads a session's schema from its subschema entry (schema-model spec). When the schema
 * cannot be read the connection stays usable without schema assistance; well-known binary
 * attributes and the `;binary` option are still treated as binary.
 */
import type { SchemaState } from '@shared/ipc'
import type { SchemaSnapshot } from '@shared/schema'
import { SchemaModel } from '@shared/schema-model'
import { toAppError } from '../ldap/errors'
import type { LdapSession } from '../ldap/session'
import { parseSubschema } from './parse'

export type { SchemaState }

const EMPTY: SchemaSnapshot = { attributeTypes: [], objectClasses: [], syntaxes: [] }

function unavailable(reason: string): SchemaState {
  return { available: false, reason, snapshot: EMPTY, warnings: [] }
}

/** Reads and parses the subschema entry. Never throws for schema problems. */
export async function readSchema(session: LdapSession): Promise<SchemaState> {
  const subschemaDn = session.rootDse.subschemaSubentry
  if (!subschemaDn) {
    return unavailable(
      'The server does not advertise a schema, so schema assistance is off for this connection.',
    )
  }
  let raw: { objectClasses: string[]; attributeTypes: string[]; ldapSyntaxes: string[] } | undefined
  try {
    raw = await session.readSubschema(subschemaDn)
  } catch (error) {
    return unavailable(
      `The schema could not be read (${toAppError(error).message}), so schema assistance is off for this connection.`,
    )
  }
  if (!raw || (raw.objectClasses.length === 0 && raw.attributeTypes.length === 0)) {
    return unavailable(
      'This account cannot read the server schema, so schema assistance is off for this connection.',
    )
  }
  const { snapshot, warnings } = parseSubschema(raw)
  return { available: true, snapshot, warnings }
}

/** Loads (or reloads) the schema and switches the session's binary detection to it. */
export async function loadSchema(session: LdapSession): Promise<SchemaState> {
  const state = await readSchema(session)
  const model = new SchemaModel(state.snapshot)
  session.isBinary = (name) => model.isBinary(name)
  session.schema = state
  return state
}
