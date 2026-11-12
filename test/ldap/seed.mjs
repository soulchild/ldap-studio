// Generates the seed LDIF and loads it into both test servers with ldapadd inside the containers.
// Idempotent: a server that already has ou=people is skipped.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const here = new URL('.', import.meta.url).pathname
const compose = ['compose', '-f', `${here}docker-compose.yml`]
const BULK_COUNT = 5000

export const SEED = {
  suffix: 'dc=example,dc=com',
  bulkCount: BULK_COUNT,
  readerDn: 'uid=reader,ou=people,dc=example,dc=com',
  readerPassword: 'reader-test-pw',
  deleterDn: 'uid=deleter,ou=people,dc=example,dc=com',
  deleterPassword: 'deleter-test-pw',
  noschemaDn: 'uid=noschema,ou=people,dc=example,dc=com',
  noschemaPassword: 'noschema-test-pw',
}

const servers = [
  { service: 'openldap', adminDn: 'cn=admin,dc=example,dc=com', createsSuffix: false },
  { service: 'dirsrv', adminDn: 'cn=Directory Manager', createsSuffix: true },
]
const ADMIN_PASSWORD = 'admin-test-pw'

const photo = readFileSync(`${here}seed/photo.jpg`)
const certificateDer = pemToDer(readFileSync(`${here}certs/server.crt`, 'utf8'))

function pemToDer(pem) {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  return Buffer.from(body, 'base64')
}

function entry(dn, attributes) {
  const lines = [`dn: ${dn}`]
  for (const [name, values] of Object.entries(attributes)) {
    for (const value of [values].flat()) {
      lines.push(Buffer.isBuffer(value) ? `${name}:: ${value.toString('base64')}` : `${name}: ${value}`)
    }
  }
  return lines.join('\n')
}

function person(uid, givenName, sn, uidNumber, extra = {}) {
  return entry(`uid=${uid},ou=people,dc=example,dc=com`, {
    objectClass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson', 'posixAccount'],
    uid,
    cn: `${givenName} ${sn}`,
    givenName,
    sn,
    mail: `${uid}@example.com`,
    uidNumber: String(uidNumber),
    gidNumber: '1000',
    homeDirectory: `/home/${uid}`,
    loginShell: '/bin/bash',
    ...extra,
  })
}

function seedLdif() {
  const entries = [
    entry('ou=people,dc=example,dc=com', { objectClass: ['top', 'organizationalUnit'], ou: 'people' }),
    entry('ou=groups,dc=example,dc=com', { objectClass: ['top', 'organizationalUnit'], ou: 'groups' }),
    entry('ou=bulk,dc=example,dc=com', {
      objectClass: ['top', 'organizationalUnit'],
      ou: 'bulk',
      description: `${BULK_COUNT} entries for paging tests`,
    }),
    person('jdoe', 'John', 'Doe', 1001, {
      jpegPhoto: photo,
      'userCertificate;binary': certificateDer,
      telephoneNumber: ['+49 30 1234567', '+49 30 7654321'],
    }),
    person('asmith', 'Alice', 'Smith', 1002),
    person('bwayne', 'Bruce', 'Wayne', 1003),
    person('reader', 'Read', 'Only', 1900, { userPassword: SEED.readerPassword }),
    person('deleter', 'Delete', 'Tester', 1901, { userPassword: SEED.deleterPassword }),
    person('noschema', 'No', 'Schema', 1902, { userPassword: SEED.noschemaPassword }),
    entry('cn=admins,ou=groups,dc=example,dc=com', {
      objectClass: ['top', 'groupOfNames'],
      cn: 'admins',
      member: ['uid=jdoe,ou=people,dc=example,dc=com', 'uid=asmith,ou=people,dc=example,dc=com'],
    }),
  ]
  for (let i = 1; i <= BULK_COUNT; i++) {
    const id = String(i).padStart(5, '0')
    entries.push(
      entry(`cn=user${id},ou=bulk,dc=example,dc=com`, {
        objectClass: ['top', 'person'],
        cn: `user${id}`,
        sn: `Bulk ${id}`,
      }),
    )
  }
  return entries.join('\n\n') + '\n'
}

function docker(args, input) {
  return execFileSync('docker', [...compose, ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function ldapExec(server, tool, args, input) {
  return docker(
    [
      'exec',
      '-T',
      server.service,
      tool,
      '-x',
      '-H',
      'ldap://localhost:' + (server.service === 'dirsrv' ? 3389 : 389),
      '-D',
      server.adminDn,
      '-w',
      ADMIN_PASSWORD,
      ...args,
    ],
    input,
  )
}

function isSeeded(server) {
  try {
    ldapExec(server, 'ldapsearch', ['-b', 'ou=people,dc=example,dc=com', '-s', 'base', 'dn'])
    return true
  } catch {
    return false
  }
}

const ldif = seedLdif()
for (const server of servers) {
  if (isSeeded(server)) {
    console.log(`${server.service}: already seeded`)
    continue
  }
  if (!server.createsSuffix) {
    ldapExec(
      server,
      'ldapadd',
      [],
      entry(SEED.suffix, { objectClass: ['top', 'dcObject', 'organization'], dc: 'example', o: 'Example' }) +
        '\n',
    )
  } else {
    // 389-DS grants no access by default; let every authenticated or anonymous client read except passwords.
    ldapExec(
      server,
      'ldapmodify',
      [],
      [
        `dn: ${SEED.suffix}`,
        'changetype: modify',
        'add: aci',
        'aci: (targetattr != "userPassword")(version 3.0; acl "test read access"; allow (read, search, compare) userdn = "ldap:///anyone";)',
        // Same rules as slapd.conf: uid=deleter may change ou=it-* containers, except cn=protected* entries.
        `aci: (target = "ldap:///ou=it-*,${SEED.suffix}")(targetattr = "*")(version 3.0; acl "test deleter"; allow (add, delete, write) userdn = "ldap:///${SEED.deleterDn}";)`,
        `aci: (target = "ldap:///cn=protected*,ou=it-*,${SEED.suffix}")(targetattr = "*")(version 3.0; acl "test protected"; deny (delete) userdn = "ldap:///anyone";)`,
        `aci: (target = "ldap:///${SEED.suffix}")(targetattr = "*")(version 3.0; acl "test deleter top"; allow (add) userdn = "ldap:///${SEED.deleterDn}";)`,
        '',
      ].join('\n'),
    )
  }
  ldapExec(server, 'ldapadd', [], ldif)
  if (server.createsSuffix) {
    // 389-DS: uid=noschema cannot read cn=schema, to test the schema fallback.
    ldapExec(
      server,
      'ldapmodify',
      [],
      [
        'dn: cn=schema',
        'changetype: modify',
        'add: aci',
        `aci: (targetattr = "*")(version 3.0; acl "test noschema"; deny (read, search, compare) userdn = "ldap:///${SEED.noschemaDn}";)`,
        '',
      ].join('\n'),
    )
  }
  console.log(`${server.service}: seeded ${BULK_COUNT + 10} entries`)
}
