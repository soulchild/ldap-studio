# LDAP test environment

Two directory servers in Docker for integration tests. **All credentials here are throwaway test values.**

| Server   | Plain LDAP / StartTLS   | LDAPS                    | Admin bind DN                |
| -------- | ----------------------- | ------------------------ | ---------------------------- |
| OpenLDAP | `ldap://localhost:3389` | `ldaps://localhost:3636` | `cn=admin,dc=example,dc=com` |
| 389-DS   | `ldap://localhost:4389` | `ldaps://localhost:4636` | `cn=Directory Manager`       |

Both use the suffix `dc=example,dc=com` and the admin password `admin-test-pw`.

`pnpm test:env:up` generates a test CA and server certificate in `test/ldap/certs/` (on first run only), then starts both servers and waits until they are healthy. The server certificate is valid for `localhost` only, so connecting to `127.0.0.1` gives a hostname mismatch, which the TLS tests rely on.

```sh
pnpm test:env:up     # start (and create certificates on first run)
pnpm test:env:check  # check both servers over LDAP, StartTLS and LDAPS
pnpm test:env:verify # check the seed data and the size limit
pnpm test:env:down   # stop and delete the containers and their data
```

## Seed data

`seed.mjs` loads the same entries into both servers on the first `up`:

- `ou=people`: `jdoe`, `asmith`, `bwayne`, `reader`, `deleter` and `noschema`, all `inetOrgPerson` + `posixAccount`. `jdoe` has a `jpegPhoto` (`seed/photo.jpg`), a `userCertificate;binary` and two `telephoneNumber` values.
- `ou=groups`: `cn=admins`, a `groupOfNames` containing `jdoe` and `asmith`.
- `ou=bulk`: 5,000 children `cn=user00001` to `cn=user05000`, for paging tests.

## Size limits

Both servers return at most 100 entries to an unpaged search. Paged searches may return everything. The admin accounts are exempt from limits, so tests that need the limit bind as `uid=reader,ou=people,dc=example,dc=com` with password `reader-test-pw`.

389-DS also has a look-through limit (5,000 entries examined per search), which returns `adminLimitExceeded`. `up.sh` lifts it for paged searches so that paging through `ou=bulk` works.

## Access rules for tests

Integration tests create their own containers named `ou=it-*`. `uid=deleter` (password `deleter-test-pw`) may add, change and delete inside them, except for entries named `cn=protected*`. Tests use that to make a subtree delete fail partway through.

`uid=noschema` (password `noschema-test-pw`) cannot read the subschema entry, which lets tests check the fallback when the schema is unavailable.
