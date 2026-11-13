# Design

## Context

Greenfield project: the repository contains only the OpenSpec setup. Motivation and scope are in proposal.md; required behavior is in the six capability specs under `specs/`.

Constraints that shape the design:
- Electron + TypeScript, no Java, and no native Node modules, so builds stay simple on macOS, Windows, and Linux.
- The renderer must not touch network, files, or secrets (app-shell spec: isolated user interface process).
- Must stay responsive with containers of 50k–100k entries and servers that cap responses (AD: 1,000).
- The schema must be a reusable service so a schema browser can be added later without rework.

## Goals / Non-Goals

**Goals:**
- Clear three-layer split (main / preload / renderer) with one typed, validated IPC contract.
- All LDAP protocol work in the main process; the renderer only holds view state.
- Shared, pure modules for DN, filter, and binary-value logic, tested without a server.
- Integration tests against real OpenLDAP and 389-DS servers.

**Non-Goals:**
- Code signing, notarization, and auto-update. Builds produced by this change are unsigned, and updates are manual. Signing and updating are planned as a follow-up change before wide distribution.
- Testing against a real Active Directory in CI. AD behavior is covered by unit tests on fixtures and manual testing.
- Persisting the operation log to disk.
- Multi-window support.

## Decisions

### 1. Tooling: electron-vite, pnpm, electron-builder
One Vite-based toolchain builds main, preload, and renderer with hot module reload in the renderer. electron-builder packages builds for macOS (dmg), Windows (NSIS), and Linux (AppImage, deb).
*Alternatives:* Electron Forge, which has a weaker Vite integration story; a hand-rolled esbuild setup, which is more work for no gain.

### 2. Project layout
```
src/
  main/        Electron main: window, IPC handlers, services
    ldap/      LdapSession, controls, paging, cert handling
    schema/    SchemaService + RFC 4512 parser
    store/     profiles, settings, secrets, history
  preload/     contextBridge exposing the typed API
  renderer/    React app (Vite, Tailwind, shadcn/ui)
  shared/      pure TS: IPC contract, DN, filter, binary formatters, types
```
`shared/` has no Electron or Node-only imports, so both sides and unit tests can use it.

### 3. Process security
`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a strict CSP (`default-src 'self'; img-src 'self' blob: data:`). The preload exposes one `window.api` object generated from the IPC contract, with no raw `ipcRenderer` access. Navigation and `window.open` are blocked. The main process alone owns file dialogs, so the renderer never sees file paths it did not get from a dialog.

### 4. Typed IPC contract with validation
`shared/ipc.ts` declares every operation as `{ request: zod schema, response: zod schema }`. Main validates every incoming payload. Two kinds of operation:
- **Invoke** (request/response) via `ipcMain.handle` for single-shot operations: connect, read entry, modify, and so on.
- **Streams** for paged tree loads, searches, subtree deletes, and the log. The renderer starts a stream and gets an `operationId`. Main pushes `{operationId, kind: 'page' | 'progress' | 'done' | 'error'}` events. `cancel(operationId)` stops it. Streams are tied to the window and connection and are torn down on disconnect.

Binary values cross IPC as `Uint8Array`, which structured clone handles without base64 overhead.
*Alternatives:* tRPC over IPC (`electron-trpc`) adds a dependency and its streaming model fits poorly; plain untyped channels are rejected.

### 5. LDAP client: ldapts
Pure TypeScript, promise-based, supports StartTLS, custom controls, and buffer-typed attributes (`explicitBufferAttributes`). One `LdapSession` per open profile owns one client connection. Single operations (read, add, modify, modify DN, delete) are multiplexed on it and run concurrently.
- **Paged operations are queued per connection.** OpenLDAP keeps only one paged-results state per connection: starting a second paged search invalidates the first one's cookie (`unwillingToPerform`, "paged results cookie is invalid or old"; 389-DS allows interleaving). Each session therefore runs tree loads, searches, subtree listings, and subtree counts one at a time, in FIFO order. A queued operation can be cancelled before it starts, and the renderer shows it as queued. This is the same single-connection model Apache Directory Studio uses. It avoids keeping the bind password in memory for extra connections. The cost: expanding a node waits while a long search runs. Revisit with a small connection pool if that proves annoying (see Risks).
- **Paging:** `ldapts` `searchPaginated()` yields one page per server round trip; each page becomes a stream event, and cancellation is checked between pages. `ldapts` does not expose the paging cookie, so a cancelled search is simply not continued instead of being released with a page-size-0 request. That is harmless: the server discards the state on the next paged search on the connection or on disconnect.
- **Empty paged results get a base check:** 389-DS answers a paged search on a missing base with success and no entries (OpenLDAP returns `noSuchObject`). When a paged search returns nothing, the session looks up the base once, so a deleted node is reported as missing rather than shown as empty.
- **Limit results:** `sizeLimitExceeded` and `adminLimitExceeded` (389-DS's look-through limit) both end a stream with the entries received so far and `incomplete: true`; they are not errors.
- **Server without paging:** if `1.2.840.113556.1.4.319` is missing from the root DSE `supportedControl`, we search without the control and surface `sizeLimitExceeded` as "incomplete".
- **Tree Delete control** (`1.2.840.113556.1.4.805`) is used when advertised (AD). Otherwise we do a depth-first, children-first delete driven by a paged subtree listing with attrs `1.1`.
- **Binary attributes:** every search asks `ldapts` for all values as raw bytes by passing an `explicitBufferAttributes` array whose `includes()` always returns true. The session then decodes each value as UTF-8, keeping it as bytes when the schema marks the attribute binary, when it was returned with `;binary`, or when it is not valid UTF-8. Raw bytes are never round-tripped through strings. (Matching a list of names instead would depend on the exact attribute-name spelling the server returns.)
- **No silent reconnects:** after a dropped connection, `ldapts` opens a new one on the next operation without binding again and without StartTLS, so a session would continue as an anonymous and possibly unencrypted client. Each session therefore allows exactly one TCP connection (plus its StartTLS upgrade) through its own `createConnection`/`createSecureConnection` factories. When that socket closes unexpectedly, the session reports the loss, and every later operation fails with `notConnected` until the user reconnects with a new session.
- **TLS options objects are created fresh per connection:** `ldapts` `startTLS()` writes the plain socket into the options object it is given, so a shared object would break the next connection.

*Alternatives:* `ldapjs` is decommissioned upstream; native OpenLDAP bindings are ruled out by the no-native-modules constraint.

### 6. TLS and certificate trust
Connections use Node `tls` options: `ca = [system roots + profile CA certificates]` and `servername = host`. To support "trust this certificate":
- On a verification failure we capture the peer certificate (`getPeerX509Certificate()`) and return its subject, issuer, validity, SHA-256 fingerprint, and the error code as a structured `CertificateUntrusted` error.
- All TLS connections, LDAPS and StartTLS, go through our own `createSecureConnection` (an `ldapts` option) that calls `tls.connect` with `rejectUnauthorized: false` and checks the result itself in a `secureConnect` listener registered before `ldapts`' own. It accepts the socket when `socket.authorized` is true (the chain is trusted and the hostname matches), or when the profile's pinned fingerprint equals the leaf certificate's `fingerprint256`. Otherwise it records a `CertificateUntrusted` error with `authorizationError` and the certificate details, and destroys the socket in that listener, so no request, bind included, is ever written. (`checkServerIdentity` cannot be used for pinning: Node does not call it when the chain is untrusted.)
- StartTLS failure aborts the connection. There is never a fallback to plain LDAP.

### 7. Profiles, settings, history, secrets
Plain JSON files in `app.getPath('userData')`: `connections.json`, `settings.json` (theme, layout, window bounds), and `history.json` (recent searches per profile, max 50). Writes are atomic: write to a temp file, then rename. Each file carries a `version` field for future migrations.

Passwords: `safeStorage.encryptString`, stored base64 in the profile. Before saving we require `safeStorage.isEncryptionAvailable()`, and on Linux `getSelectedStorageBackend() !== 'basic_text'`. Otherwise saving is refused, as the connection-management spec requires. Profiles sent to the renderer are mapped to a DTO with `hasSavedPassword: boolean` only.

### 8. Schema service
The RFC 4512 parser for `objectClasses`, `attributeTypes`, and `ldapSyntaxes` lives in `main/schema/` and produces a resolved model: superior chains flattened, MUST/MAY inherited, and lookups case-insensitive by name, alias, or OID. The binary decision combines the syntax OID set (Octet String `1.3.6.1.4.1.1466.115.121.1.40`, JPEG `.28`, Certificate `.8`, Certificate List `.9`, and similar), the `;binary` option, and a hard-coded AD list (`objectGUID`, `objectSid`, `msExchMailboxGuid`, `thumbnailPhoto`, ...).

The service caches the model per session and sends a serializable snapshot to the renderer once per connect or reload. Autocomplete and validation then run synchronously in the renderer. A later schema browser reads the same snapshot.
*Alternative:* querying main for every keystroke adds IPC latency to autocomplete, so it was rejected.

### 9. Shared DN and filter modules
- **DN:** RFC 4514 parser and serializer with escaping, plus `normalize()` for comparison: lower-cased attribute types, case-folded values (approximation of matching rules, adequate for lookup and tree identity), and whitespace trimmed. The tree indexes nodes by normalized DN.
- **Filter:** RFC 4515 parser that returns an AST or `{error, offset}`, used for live validation and to find the cursor context for autocomplete (attribute position vs. `objectClass` value position).

### 10. Renderer architecture
- **State:** Zustand stores split by concern: `connections`, `tree` (normalized node map per connection plus expanded set), `editor` (loaded entry, pending changes), `search`, and `log`. No server-cache library, because stream-driven loads map poorly to query caches.
- **Tree rendering:** the visible tree is flattened into an array (recomputed incrementally on expand, collapse, or page arrival) and rendered with TanStack Virtual, with fixed row height for O(1) layout. Keyboard navigation is handled on the flattened list.
- **Tree filter:** a bar at the top of the directory pane, modelled on Directory Studio's quick search (user's choice, replacing an earlier per-node filter of loaded children). Attribute, operator and value become an LDAP filter, searched on the server below the selected entry with scope one or sub, at most 1,000 matches, through the per-connection queue. The matches and the entries leading to them replace the tree until the filter is cleared; picking a match reveals it in the real tree, so clearing returns to it.
- **Filter field and attribute inputs:** a single-line CodeMirror 6 instance gives syntax highlighting, error marks at the parser offset, and schema-driven completion.
- **Results table:** TanStack Table + TanStack Virtual. Sorting is client-side over loaded rows.
- **Layout:** resizable panel groups (shadcn `Resizable`). Sizes are persisted through settings.
- **Theming:** CSS variables in Tailwind for light and dark tokens. The renderer's theme choice is mirrored to `nativeTheme.themeSource`, so native menus, scrollbars, and dialogs match. `nativeTheme` `updated` events drive live switching in system mode.

### 11. Entry editing model
The editor keeps `original` (as loaded) and `working` copies, keyed by attribute with value lists (`string | Uint8Array`). A pure diff function produces the modify change list:
- single-valued or fully rewritten attribute → `replace`
- attribute without an EQUALITY matching rule (such as `jpegPhoto`) → `replace` with all values, because servers refuse adding or deleting single values they cannot compare (found in task 12.2: OpenLDAP answers "no equality matching rule")
- multi-valued → per-value `add` and `delete`, so other values and concurrent additions are untouched
- attribute removed → `delete` without values

The preview dialog renders exactly this list, and save sends it as one modify request. Untouched attributes, including binary ones, are never part of the request, which guarantees byte-identical preservation.

**Stale detection:** on load we read a change marker (`entryCSN` for OpenLDAP and 389-DS, `uSNChanged` for AD, falling back to `modifyTimestamp`). On save, if the server supports the Assertion control (RFC 4528, `1.3.6.1.1.12`), the modify carries `(marker=<loaded value>)`, and an `assertionFailed` result triggers the reload/overwrite prompt. Without the control we re-read the marker before the modify (a best-effort check, accepted).

Findings from task 4.5: OpenLDAP supports the Assertion control and has `entryCSN`. 389-DS has neither (no Assertion control, and `entryCSN` is empty without replication), so it uses the re-read fallback with `modifyTimestamp`, which has one-second precision: two changes within the same second are not detected. `ldapts` lists requested-but-absent attributes with no values, so reads drop empty attributes. Rename uses a `ModifyDNRequest` sent through `ldapts` internals, because `Client.modifyDN` always deletes the old RDN value; `entries.int.test.ts` guards that against library upgrades.

Create and copy reuse the same editor in "new entry" mode, sending an add request. Rename and move use modify DN with `deleteOldRdn` from the user's choice, and `newSuperior` for moves.

### 12. Binary value presentation
Formatting runs in `shared/` (pure): GUID byte-order formatting, SID decoding, hex preview, and image sniffing by magic bytes (JPEG, PNG, GIF). Certificate decoding runs in main via Node's `crypto.X509Certificate` (one invoke operation), because the renderer has no Node APIs. Thumbnails are `blob:` URLs created from the bytes in the renderer. Save and replace go through main-owned file dialogs.

### 13. Operation log
Main wraps every LDAP call in the session to emit a log record (timestamp, profile, op, DN, result code, message, duration). Passwords are never recorded, and binary values are summarized as "<n bytes>". Records are kept in an in-memory ring buffer of 5,000 entries and streamed to the renderer.

### 14. Testing
- **Unit (Vitest):** DN, filter, schema parser (fixture dumps from OpenLDAP, 389-DS, and AD), diff builder, binary formatters, profile store, and secret-handling rules.
- **Integration (Vitest + Docker Compose):** OpenLDAP and 389-DS containers seeded with an LDIF fixture that includes a container of 5,000+ children, run with a low server size limit to force paging. These cover connect over all three transports (self-signed CA generated at test setup), paging, cancellation, CRUD, modify DN, subtree delete, assertion-control stale detection, and binary round-trip.
- **End-to-end smoke (Playwright `_electron`):** launch, create a profile, connect, expand, edit, search, and toggle theme.

### 15. Visual direction
Set by the user: a roomy layout where elements breathe, the system font, a look in the spirit of Linear, no gradients or fake reflections, colour only where it carries meaning, and a distinctive cross-platform look rather than an imitation of macOS.
- **Colour:** cool neutral greys with a faint blue tint, and one accent (cobalt `#3D5CCC`, `#7C93F0` in dark mode) used only for selection, focus and the primary action. Status colours only where they mean something: green for connected, amber for plain LDAP or incomplete results, red for errors and destructive actions.
- **Type:** the system UI font at 13 px base, 12 px secondary and 18 px for the entry title, with weights 400/500/600. A monospace font only for attribute values, DNs in the editor and the filter field, never for labels. Labels are sentence case.
- **Layout:** the left column holds the directory tree on top and the connections list in the lower left (user's choice), the entry editor fills the main area, and the collapsible results/log panel sits below the editor.
- **Spacing:** a 4 px grid with 28 px rows in the tree and results (about 20 px in Directory Studio), and padding of 14–20 px in panes. Slightly tightened from 32 px rows after the first review (user's choice).
- **The one distinctive element:** the entry editor's header. It shows the DN as a navigable path of RDN segments (attribute type muted, value strong; clicking a segment opens that ancestor), then the entry's type in an accent-tinted tile, its name, and its object classes as tags (structural outlined, auxiliary muted). Everything around it stays quiet.
- **Entry types:** the tree, the header and the search results show an icon for the kind of entry (domain, organization, container, group, person, computer, alias, policy), decided by object class or, where the classes are unknown, by the RDN's attribute type. The icons are grey; only the selected tree row's icon takes the accent.
- **Surfaces:** flat panes separated by 1 px borders, no cards, no decorative shadows (one subtle shadow on popovers and dialogs only), and modest radii (4 px on controls, 8 px on dialogs).

## Risks / Trade-offs

- Spike findings (task 4.1, verified against OpenLDAP and 389-DS in `test/integration/ldapts-spike.int.test.ts`, which stays as a regression test of these library assumptions):
  - `searchPaginated()` streams pages, and a connection stays usable after a paged search is stopped mid-way. There is no public abandon operation and no access to the cookie.
  - OpenLDAP rejects interleaved paged searches on one connection; 389-DS accepts them. This led to the per-connection queue in Decision 5.
  - The certificate, `authorized` flag, and `authorizationError` (untrusted chain or hostname mismatch) are available through `createSecureConnection` for both LDAPS and StartTLS, and destroying the socket in `secureConnect` stops the connection before the bind is sent.
  - `explicitBufferAttributes` with an always-matching `includes()` returns every value as bytes.
- [`react-resizable-panels` 4.15's `groupResizeBehavior: 'preserve-pixel-size'` did not keep panes at their pixel size when the window was resized in this app] → The sidebar, connections pane and bottom panel use `useFixedPane`: a `ResizeObserver` per panel group re-applies the desired pixel size with `setLayout`, and only user drags (`isUserInteraction`) change the desired size. Settings store these sizes in pixels.
- [Queued paged operations: expanding a node waits behind a long search or subtree listing] → The renderer shows the node as queued and lets the user cancel the running operation. If this proves annoying, move paged operations to a small per-session pool of extra connections. That changes only the session internals, not the IPC contract, but requires keeping the bind password in main-process memory.
- [A cancelled paged search leaves its cookie on the server until the next paged search or disconnect] → Accepted; both servers clean it up then.
- [Approximate DN normalization (case folding) can mis-identify DNs with case-sensitive matching rules] → Rare in practice for naming attributes. The tree always uses the server-returned DN for operations, and normalization is used only for identity and lookup.
- [Linux without a keyring cannot save passwords] → Required behavior per spec. The message explains how to install or enable a keyring.
- [Unsigned builds trigger OS warnings (Gatekeeper, SmartScreen)] → Acceptable for the MVP and internal use. Signing is a planned follow-up.
- [AD behavior isn't covered by CI] → Fixture-based unit tests for the AD schema and binary formats, plus a manual AD test checklist in the tasks.
- [Virtualized tree with 100k nodes: recomputing the flattened list is O(n)] → Recompute incrementally per subtree, and append pages instead of rebuilding.

## Open Questions

- Default page size for tree and search paging: start with 500 and tune after integration tests against AD-like limits.
- The exact list of hard-coded AD binary attributes beyond the core set. Extend it as we encounter more.
