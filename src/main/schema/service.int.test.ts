import { randomUUID } from 'node:crypto'
import { Attribute, Change, Client } from 'ldapts'
import { afterEach, describe, expect, it } from 'vitest'
import { SchemaModel } from '@shared/schema-model'
import {
  NOSCHEMA,
  SUFFIX,
  TEST_SERVERS,
  testCaPem,
  testEnvAvailable,
  type TestServer,
} from '../../../test/integration/env'
import { LdapSession } from '../ldap/session'
import { loadSchema } from './service'

const sessions: LdapSession[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()))
})

async function open(server: TestServer, dn = server.adminDn, password = server.adminPassword) {
  const result = await LdapSession.open({
    host: server.host,
    port: server.ldapPort,
    security: 'none',
    bindDn: dn,
    password,
    caCertificates: [testCaPem()],
  })
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  sessions.push(result.value)
  return result.value
}

describe.runIf(testEnvAvailable).each(TEST_SERVERS)('schema loading on $name (task 6.3)', (server) => {
  it('loads the schema on connect and uses it for binary detection', async () => {
    const session = await open(server)
    const state = await loadSchema(session)
    expect(state.available).toBe(true)
    expect(state.warnings).toEqual([])
    const model = new SchemaModel(state.snapshot)
    expect(model.objectClass('inetOrgPerson')).toBeDefined()
    expect(model.attributeType('mail')).toBeDefined()
    expect(session.schema).toBe(state)
    expect(session.isBinary('userCertificate')).toBe(true)
    expect(session.isBinary('mail')).toBe(false)
  })

  it('falls back without schema assistance when the account cannot read the schema', async () => {
    const session = await open(server, NOSCHEMA.dn, NOSCHEMA.password)
    const state = await loadSchema(session)
    expect(state).toMatchObject({
      available: false,
      reason: expect.stringContaining('schema assistance is off'),
      snapshot: { attributeTypes: [], objectClasses: [] },
    })
    expect(session.isBinary('objectGUID')).toBe(true)
    expect(session.isBinary('userCertificate;binary')).toBe(true)
    // The connection stays usable.
    const entry = await session.readEntry(`uid=jdoe,ou=people,${SUFFIX}`, false)
    expect(entry?.attributes.find((attribute) => attribute.name === 'cn')?.values).toEqual(['John Doe'])
  })
})

describe.runIf(testEnvAvailable)('schema reload', () => {
  // 389-DS accepts schema changes at runtime; the OpenLDAP test server uses a static slapd.conf.
  const server = TEST_SERVERS.find((candidate) => candidate.name === '389ds')

  it('picks up an attribute type added on the server', async () => {
    if (!server) {
      throw new Error('389-DS test server missing')
    }
    const name = `itTestAttr${randomUUID().slice(0, 8)}`
    const definition = `( 1.3.6.1.4.1.99999.${Date.now() % 100000}.1 NAME '${name}' DESC 'reload test' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )`
    const session = await open(server)
    expect(new SchemaModel((await loadSchema(session)).snapshot).attributeType(name)).toBeUndefined()

    const admin = new Client({ url: `ldap://${server.host}:${server.ldapPort}` })
    await admin.bind(server.adminDn, server.adminPassword)
    const change = (operation: 'add' | 'delete') =>
      new Change({ operation, modification: new Attribute({ type: 'attributeTypes', values: [definition] }) })
    try {
      await admin.modify('cn=schema', change('add'))
      expect(new SchemaModel((await loadSchema(session)).snapshot).attributeType(name)).toBeDefined()
    } finally {
      await admin.modify('cn=schema', change('delete')).catch(() => undefined)
      await admin.unbind()
    }
  })
})
