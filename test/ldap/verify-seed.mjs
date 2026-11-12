// Checks the seed counts and that the size limit forces paging for normal users.
import { readFileSync } from 'node:fs'
import { Client } from 'ldapts'

const here = new URL('.', import.meta.url).pathname
const photo = readFileSync(`${here}seed/photo.jpg`)
const servers = [
  { name: 'OpenLDAP', url: 'ldap://localhost:3389', adminDn: 'cn=admin,dc=example,dc=com' },
  { name: '389-DS', url: 'ldap://localhost:4389', adminDn: 'cn=Directory Manager' },
]
const BULK = 'ou=bulk,dc=example,dc=com'
let failed = false

function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) {
    failed = true
  }
}

async function withClient(url, dn, password, run) {
  const client = new Client({ url, timeout: 30000 })
  try {
    await client.bind(dn, password)
    return await run(client)
  } finally {
    await client.unbind().catch(() => {})
  }
}

for (const server of servers) {
  await withClient(server.url, server.adminDn, 'admin-test-pw', async (client) => {
    const bulk = await client.search(BULK, { scope: 'one', attributes: ['1.1'], paged: { pageSize: 500 } })
    check(`${server.name} bulk children`, bulk.searchEntries.length === 5000, `${bulk.searchEntries.length}`)
    const people = await client.search('ou=people,dc=example,dc=com', { scope: 'one', attributes: ['1.1'] })
    check(`${server.name} people`, people.searchEntries.length === 6, `${people.searchEntries.length}`)
    const posix = await client.search('ou=people,dc=example,dc=com', {
      filter: '(objectClass=posixAccount)',
      attributes: ['1.1'],
    })
    check(
      `${server.name} posixAccount entries`,
      posix.searchEntries.length === 6,
      `${posix.searchEntries.length}`,
    )
    const jdoe = await client.search('uid=jdoe,ou=people,dc=example,dc=com', {
      scope: 'base',
      attributes: ['jpegPhoto', 'userCertificate;binary'],
      explicitBufferAttributes: ['jpegPhoto', 'userCertificate;binary', 'userCertificate'],
    })
    const entry = jdoe.searchEntries[0] ?? {}
    const storedPhoto = entry.jpegPhoto
    check(
      `${server.name} jpegPhoto byte-exact`,
      Buffer.isBuffer(storedPhoto) && storedPhoto.equals(photo),
      `${storedPhoto?.length} bytes`,
    )
    const cert = entry['userCertificate;binary'] ?? entry.userCertificate
    check(
      `${server.name} userCertificate present`,
      Buffer.isBuffer(cert) && cert[0] === 0x30,
      `${cert?.length} bytes`,
    )
  })

  await withClient(server.url, 'uid=reader,ou=people,dc=example,dc=com', 'reader-test-pw', async (client) => {
    let limited = false
    try {
      await client.search(BULK, { scope: 'one', attributes: ['1.1'] })
    } catch (error) {
      limited = /size limit/i.test(String(error?.message)) || error?.code === 4
    }
    check(`${server.name} unpaged search hits the size limit`, limited)
    const paged = await client.search(BULK, { scope: 'one', attributes: ['1.1'], paged: { pageSize: 100 } })
    check(
      `${server.name} paged search returns everything`,
      paged.searchEntries.length === 5000,
      `${paged.searchEntries.length}`,
    )
  })
}
process.exit(failed ? 1 : 0)
