# Tasks

## 1. Project setup

- [x] 1.1 Scaffold the electron-vite + React + TypeScript project with pnpm, strict tsconfig, and the `src/{main,preload,renderer,shared}` layout from design §2; verify `pnpm dev` opens an empty window and `pnpm typecheck` passes
- [x] 1.2 Add Tailwind, shadcn/ui, ESLint (with the `curly: all` rule), Prettier, and Vitest; verify `pnpm lint` and an example `pnpm test` pass
- [x] 1.3 Add an import-boundary lint rule so `src/shared` cannot import Electron or Node-only modules and the renderer cannot import `src/main`; verify that a deliberate violating import fails `pnpm lint`
- [x] 1.4 Write a README covering prerequisites and the dev, test, and build commands; verify the commands run as documented on a clean checkout

## 2. Shared pure modules

- [x] 2.1 Implement the RFC 4514 DN parser, serializer, escaping, and `normalize()` in `shared/dn`; verify unit tests cover escaped characters, multi-valued RDNs, whitespace, and case-insensitive equality
- [x] 2.2 Implement the RFC 4515 filter parser that returns an AST or `{error, offset}` plus cursor-context detection (attribute vs. objectClass value) in `shared/filter`; verify unit tests cover nested and/or/not, escapes, extensible match, unbalanced parentheses with the correct offset, and the context cases
- [x] 2.3 Implement binary formatters in `shared/binary` (AD GUID string, SID string, hex preview, image magic-byte sniffing, human-readable size); verify unit tests with known AD GUID and SID byte fixtures
- [x] 2.4 Implement the entry diff builder (original vs. working → modify change list per design §11); verify unit tests cover single-valued replace, multi-valued add/delete per value, attribute removal, binary values compared by bytes, and untouched attributes being excluded
- [x] 2.5 Define the IPC contract in `shared/ipc.ts` (zod schemas for invoke operations and stream events: page/progress/done/error, operationId, cancel); verify the type tests compile and schema round-trip unit tests pass

## 3. Integration test environment

- [x] 3.1 Add Docker Compose with OpenLDAP and 389-DS, a test CA plus server certificates generated at setup, and LDAP/LDAPS/StartTLS enabled; verify `pnpm test:env:up` starts both and `ldapsearch` (or a small script) reaches each on all three transports
- [x] 3.2 Add seed LDIF (people/groups, a container with 5,000+ children, entries with jpegPhoto and userCertificate, posixAccount entries) and configure a low server size limit to force paging; verify seed counts with a check script
- [x] 3.3 Add a Vitest integration project that runs against the containers and is skipped when they are not running; verify a trivial connect test passes against both servers

## 4. LDAP session core (main)

- [x] 4.1 Spike: with ldapts, drive the Paged Results control page by page, release the cookie on cancel, and capture the peer certificate on TLS verification failure (fall back to a `tls.connect` probe); verify with integration tests and record the findings in design.md Risks
- [x] 4.2 Implement `LdapSession` connect for plain LDAP, LDAPS, and StartTLS with system roots plus profile CAs, hostname check, no StartTLS fallback, and fingerprint pinning via custom `checkServerIdentity`; verify integration tests for each transport, an untrusted self-signed cert (structured `CertificateUntrusted` error with fingerprint), a pinned success, a pinned mismatch, and StartTLS refused
- [x] 4.3 Implement simple and anonymous bind with mapped result codes and diagnostics, and read the root DSE (naming contexts, supportedControl, subschemaSubentry); verify integration tests for wrong password (invalid credentials), anonymous bind, and naming contexts
- [x] 4.4 Implement a paged search stream with per-page emission, cancellation, size limit, the no-paging fallback (incomplete flag), and binary-attribute buffer handling; verify integration tests that list the 5,000-child container fully, cancel mid-way, hit the size limit, and keep binary values byte-exact
- [x] 4.5 Implement read entry (with optional operational attributes and change marker), add, modify (with optional Assertion control), modify DN, and delete; verify integration tests including an assertion failure after a concurrent change
- [x] 4.6 Implement subtree delete: count via paged `1.1` listing, Tree Delete control when advertised, otherwise children-first, with progress events, cancellation, and partial-failure reporting; verify integration tests for a full delete, cancel partway, and permission-denied partway (deleted count and failing DN)
- [x] 4.7 Implement the operation log ring buffer (5,000 records) with password redaction and binary summarization, and connection-loss detection; verify unit tests that the bind log has no password, and an integration test that stopping the container marks the session as disconnected

## 5. Persistence and secrets (main)

- [x] 5.1 Implement atomic JSON stores (connections, settings, history) with a `version` field in userData; verify unit tests for atomic write, corrupt-file handling, and version field presence
- [x] 5.2 Implement profile CRUD and duplicate (without password), with a DTO that exposes only `hasSavedPassword`; verify unit tests that duplicate drops the password and the DTO never contains password data
- [x] 5.3 Implement safeStorage password save/load with refusal when encryption is unavailable or the Linux backend is `basic_text`; verify unit tests with a mocked safeStorage for all three cases and that no plain-text password appears in the written file
- [x] 5.4 Implement recent-search history per profile (dedupe, move to top, cap of 50); verify unit tests for dedupe, ordering, and cap

## 6. Schema service (main)

- [x] 6.1 Implement the RFC 4512 parser for objectClasses, attributeTypes, and ldapSyntaxes; verify unit tests against fixture dumps from OpenLDAP, 389-DS, and AD
- [x] 6.2 Build the resolved model (inherited MUST/MAY, superior chain, case-insensitive name/alias/OID lookup, single-value, user-modifiable, binary detection per design §8) and a serializable snapshot; verify unit tests for inetOrgPerson inheritance, inetOrgPerson+posixAccount required attributes, the cn/CommonName alias, and the binary flags for userCertificate and objectGUID
- [x] 6.3 Load the schema on connect, support reload, and fall back gracefully when the subschema is unreadable; verify integration tests on both servers and a test with a restricted bind user that gets the fallback notice

## 7. IPC, preload, and app shell

- [x] 7.1 Wire main IPC handlers with zod validation and a stream registry tied to window and session, and expose the typed `window.api` through the preload; verify unit tests that invalid payloads are rejected and streams are cleaned up on disconnect
- [x] 7.2 Harden the window (contextIsolation, sandbox, no nodeIntegration, CSP, blocked navigation and window.open); verify with a Playwright check that `require` and `process` are undefined in the renderer and that navigation is blocked
- [x] 7.3 Build the multi-pane layout (connections, tree, editor, bottom panel with Results and Log tabs) with resizable and collapsible panels, and persist sizes plus window bounds; verify manually and with a Playwright test that sizes persist across relaunch
- [x] 7.4 Implement light, dark, and system themes with CSS variable tokens synced to `nativeTheme.themeSource` and live system switching; verify the toggle persists across relaunch and the system mode follows OS changes
- [x] 7.5 Implement the Log panel (streamed records, virtualized, filter by connection); verify the panel shows bind and search records with no password visible
- [x] 7.6 Add global keyboard shortcuts (focus DN lookup, open search, save, discard) and a shortcuts help overlay; verify each shortcut in a Playwright test

## 8. Connection management UI

- [x] 8.1 Build the connections pane with per-profile state (disconnected, connecting, connected, error) and connect/disconnect/reconnect actions, allowing several open at once; verify with a Playwright test against the test containers
- [x] 8.2 Build the profile editor (create, edit, duplicate, delete with confirmation, transport mode with default ports, plain-LDAP warning, CA import through a main-owned file dialog) and a test-connection action reporting network/TLS/certificate/bind failures; verify the spec scenarios manually and with Playwright
- [x] 8.3 Build the password prompt with a "save password" option and the untrusted-certificate dialog (subject, issuer, validity, fingerprint, reason, trust action); verify the prompt-without-save and trust-then-reconnect flows against the containers

## 9. Directory tree and DN lookup

- [x] 9.1 Build the tree store (normalized node map per connection, expanded set) and an incremental flattening of visible nodes; verify unit tests for expand, collapse, and page append producing the correct flattened list
- [x] 9.2 Render the virtualized tree with roots from base DN or naming contexts, load-on-expand streams, running counts, a loading row, incomplete notices, cancel on collapse, leaf detection, and keyboard navigation; verify with Playwright against the 5,000-child container and a manual performance check with 100k synthetic nodes
- [x] 9.3 Add the tree filter (attribute, operator, value; children or whole subtree, searched on the server), refresh (keeping expanded state), and Copy DN; verify Playwright tests for the filter and refresh-after-external-add
- [x] 9.4 Implement DN lookup as a Go to DN dialog reachable from the command palette (syntax validation, reveal by loading ancestors, select and open, nearest existing ancestor on no-such-object); verify Playwright tests for the deep-jump, missing-DN, and invalid-syntax scenarios
- [x] 9.5 Show the disconnected/read-only state on connection loss (content kept, edit actions disabled); verify by stopping the container during a session

## 10. Entry viewing and editing

- [x] 10.1 Build the entry editor view (DN header, one row per value, required markers, operational attributes toggle with read-only marking); verify with Playwright on an inetOrgPerson entry
- [x] 10.2 Implement editing: change, add, and remove values, add an attribute with schema-limited autocomplete, single-value enforcement, non-modifiable attributes locked, and pending-change markers plus discard; verify component tests and Playwright
- [x] 10.3 Implement schema checks before save, the change preview dialog from the diff builder, atomic save, errors shown with pending changes kept, and the stale-entry prompt (reload/overwrite); verify Playwright tests for required-attribute removal, a server rejection, and a concurrent change
- [x] 10.4 Implement the unsaved-changes guard on navigation (save/discard/stay) and Copy value/attribute; verify with Playwright

## 11. Entry lifecycle operations

- [x] 11.1 Implement create-child (object class picker requiring a structural class, RDN, required attributes prefilled) in new-entry editor mode; verify the "New person" and auxiliary-only scenarios with Playwright
- [x] 11.2 Implement create-from-copy (user attributes only, new RDN, optional new parent); verify with Playwright that nothing is created until save
- [x] 11.3 Implement rename (keep or delete the old RDN value) and move through a parent picker and tree drag-and-drop with a confirmation showing old and new DN; verify Playwright tests for rename, drag-and-drop move, and a server refusal leaving the tree unchanged
- [x] 11.4 Implement delete and subtree delete UI (count confirmation, progress, cancel, partial-failure report, tree refresh); verify Playwright tests for leaf delete, a 121-entry subtree delete, and permission-denied partway

## 12. Binary values

- [x] 12.1 Implement type-aware binary display (image thumbnail via blob URL, certificate details via main `X509Certificate`, AD GUID/SID strings, hex preview with size); verify against seeded jpegPhoto and userCertificate entries and unit-tested AD fixtures
- [x] 12.2 Implement save-to-file, replace-from-file, and add-value-from-file through main-owned dialogs; verify integration tests that the bytes round-trip identically and that editing another attribute leaves jpegPhoto byte-identical
- [x] 12.3 Add the password dialog for `userPassword` (hash method shown instead of the value; SSHA/SHA-2/PKCS5S2/Plaintext hashing in `shared/password` with Web Crypto, no weak methods); verify unit tests against hashlib reference values and a Playwright test that sets an SSHA password, saves, and binds with it

## 13. Search

- [x] 13.1 Build the search view (filter field with CodeMirror validation, error marks, schema autocomplete, and unknown-attribute warnings; base DN chosen in the DN browser dialog; scope; attribute list with autocomplete; size limit; defaults from selection); verify the spec scenarios with component tests and Playwright
- [x] 13.2 Build the results table (virtualized, DN plus requested attribute columns, multi-value cells, binary descriptions, sorting, streaming, cancel, size-limit notice, errors that keep partial results) with open-in-editor and reveal-in-tree; verify a 5,000-result search with Playwright
- [x] 13.3 Add the recent searches list (persisted per profile, rerun fills the parameters); verify with Playwright that history survives relaunch and deduplicates

## 14. Packaging and integration checks

- [ ] 14.1 Configure electron-builder for macOS dmg, Windows NSIS, and Linux AppImage/deb (unsigned); verify each build artifact installs and launches on a machine without Java
- [ ] 14.2 Add an end-to-end Playwright smoke test (create profile → connect → expand → edit and save → search → toggle theme) running in CI with the test containers; verify the CI run passes
- [ ] 14.3 Write and run a manual Active Directory checklist (simple bind over LDAPS, 1,000-entry paging, objectGUID/objectSid display, Tree Delete, schema load); verify by recording the results in `docs/ad-checklist.md`
- [x] 14.4 Run `openspec validate ldap-studio-mvp --strict` and confirm every spec scenario is covered by a test or checklist item; verify the command passes
