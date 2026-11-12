// Reads the root DSE of both test servers over plain LDAP, StartTLS and LDAPS,
// verifying TLS against the test CA and the "localhost" hostname.
import { readFileSync } from 'node:fs'
import { Client } from 'ldapts'

const ca = readFileSync(new URL('./certs/ca.crt', import.meta.url))
// A fresh object per connection: ldapts' startTLS() writes the old socket into the options it is given.
const tlsOptions = () => ({ ca: [ca], servername: 'localhost', rejectUnauthorized: true })

const servers = [
  { name: 'OpenLDAP', ldap: 3389, ldaps: 3636 },
  { name: '389-DS', ldap: 4389, ldaps: 4636 },
]

async function readRootDse(url, { startTls = false, tls } = {}) {
  const client = new Client({ url, tlsOptions: tls, timeout: 5000, connectTimeout: 5000 })
  try {
    if (startTls) {
      await client.startTLS(tlsOptions())
    }
    const { searchEntries } = await client.search('', { scope: 'base', attributes: ['namingContexts'] })
    return [searchEntries[0]?.namingContexts].flat().filter(Boolean)
  } finally {
    await client.unbind().catch(() => {})
  }
}

let failed = false
for (const server of servers) {
  const checks = [
    ['plain LDAP', () => readRootDse(`ldap://localhost:${server.ldap}`)],
    ['StartTLS', () => readRootDse(`ldap://localhost:${server.ldap}`, { startTls: true })],
    ['LDAPS', () => readRootDse(`ldaps://localhost:${server.ldaps}`, { tls: tlsOptions() })],
  ]
  for (const [label, run] of checks) {
    try {
      const contexts = await run()
      console.log(`ok    ${server.name} ${label}: ${contexts.join(', ') || '(no naming contexts)'}`)
    } catch (error) {
      failed = true
      console.log(`FAIL  ${server.name} ${label}: ${error instanceof Error ? error.message : error}`)
    }
  }
}
process.exit(failed ? 1 : 0)
