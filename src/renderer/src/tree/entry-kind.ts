/**
 * What kind of entry something is, for its icon: decided by object class, or by the RDN's
 * attribute type where the classes are not known yet (naming contexts, search results).
 */
export type EntryKind =
  'domain' | 'organization' | 'container' | 'group' | 'person' | 'computer' | 'alias' | 'policy' | 'other'

/** Checked in order: an AD computer is also a user, and a group must win over its members' classes. */
const BY_CLASS: [EntryKind, string[]][] = [
  ['alias', ['alias']],
  ['computer', ['computer', 'device', 'iphost', 'msds-managedserviceaccount']],
  ['group', ['group', 'groupofnames', 'groupofuniquenames', 'groupofurls', 'posixgroup', 'groupofmembers']],
  ['person', ['person', 'organizationalperson', 'inetorgperson', 'user', 'posixaccount', 'account']],
  ['domain', ['domain', 'dcobject', 'domaindns', 'country']],
  ['organization', ['organization']],
  ['policy', ['pwdpolicy', 'passwordpolicy', 'subentry', 'ldapsubentry', 'olcglobal']],
  ['container', ['organizationalunit', 'container', 'builtindomain', 'nscontainer', 'locality']],
]

const BY_RDN_TYPE: Record<string, EntryKind> = {
  dc: 'domain',
  c: 'domain',
  o: 'organization',
  ou: 'container',
  l: 'container',
  uid: 'person',
}

export function entryKind(objectClasses: readonly string[], rdn: string): EntryKind {
  const classes = new Set(objectClasses.map((name) => name.toLowerCase()))
  for (const [kind, names] of BY_CLASS) {
    if (names.some((name) => classes.has(name))) {
      return kind
    }
  }
  const type = rdn.slice(0, rdn.indexOf('=')).trim().toLowerCase()
  return BY_RDN_TYPE[type] ?? 'other'
}

export const KIND_LABELS: Record<EntryKind, string> = {
  domain: 'Domain',
  organization: 'Organization',
  container: 'Container',
  group: 'Group',
  person: 'Person',
  computer: 'Computer',
  alias: 'Alias',
  policy: 'Policy',
  other: 'Entry',
}
