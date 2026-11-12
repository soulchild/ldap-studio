import { Client } from 'ldapts'
import { describe, expect, it } from 'vitest'
import { SUFFIX, TEST_SERVERS, testEnvAvailable } from './env'

describe.runIf(testEnvAvailable).each(TEST_SERVERS)('test server $name', (server) => {
  it('accepts an admin bind and advertises the test suffix', async () => {
    const client = new Client({ url: `ldap://${server.host}:${server.ldapPort}`, timeout: 5000 })
    try {
      await client.bind(server.adminDn, server.adminPassword)
      const { searchEntries } = await client.search('', { scope: 'base', attributes: ['namingContexts'] })
      expect([searchEntries[0]?.namingContexts].flat()).toContain(SUFFIX)
    } finally {
      await client.unbind()
    }
  })
})
