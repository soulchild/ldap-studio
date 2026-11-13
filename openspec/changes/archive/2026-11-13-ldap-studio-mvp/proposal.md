# Proposal

## Why

Apache Directory Studio is the de-facto LDAP GUI, but it requires a Java runtime and inherits the sluggish, cluttered feel of the Eclipse RCP platform. ldap-studio is a fast, modern, cross-platform desktop replacement that covers the ~80% of day-to-day directory work (connect, browse, look up, search, edit) without Java or Eclipse.

## What Changes

- New Electron + TypeScript desktop application with a multi-pane layout (connections, directory tree, entry editor, search results/log), modern look and feel, and light/dark mode.
- Connection management: create, edit, delete, and test connection profiles; simple bind (DN + password) over plain LDAP, LDAPS, or StartTLS; custom CA certificates and "trust this certificate" fingerprint pinning. Targets OpenLDAP, 389-DS, and Active Directory (simple bind).
- Secure credential storage: bind passwords optionally saved per connection, encrypted via the OS keychain (Electron `safeStorage`); weak-storage fallbacks are detected and the user is warned or saving is refused.
- Schema awareness without a schema UI: the server schema (`cn=subschema`) is loaded per connection and drives attribute autocomplete, required/allowed attributes, single- vs multi-value handling, and binary detection everywhere. Built as a standalone service so a schema browser can be added later.
- Directory tree: lazy loading of children on expand, streamed in pages via the Paged Results control into a virtualized tree, with live counts, a server-side tree filter (attribute, operator, value; children or whole subtree), and cancellation.
- DN lookup: a Go to DN dialog that accepts a DN and jumps to the entry in the tree.
- Command palette: every common action, found by typing.
- Search: raw LDAP filter with syntax validation and schema-based autocomplete; base DN, scope, attribute list, and size limit; virtualized results table that opens entries in the editor; automatic recent-search history.
- Entry operations: create (schema-guided, pre-filled required attributes), create from copy, inline edit with a reviewable change preview applied as a single modify, rename/move (modify DN, including drag-and-drop), delete and confirmed subtree delete (Tree Delete control when supported, otherwise children-first).
- Binary attributes: always handled as raw bytes; type-aware views (image thumbnails, decoded certificates, `objectGUID`/`objectSid` strings, hex/base64 fallback) with replace-from-file and save-to-file.

Out of scope for this change: schema browser UI, SASL/Kerberos/GSSAPI, Virtual List View, visual filter builder, named saved searches, LDIF import/export.

## Capabilities

### New Capabilities

- `connection-management`: Connection profiles, bind and transport security options (LDAP/LDAPS/StartTLS, CA and certificate trust), connect/disconnect lifecycle, and secure password storage.
- `schema-model`: Loading, parsing, and caching the server schema per connection and exposing a typed model (object classes, attribute types, syntaxes, single-value and binary flags) to the rest of the application.
- `directory-tree`: Browsable tree of directory entries with lazy, paged, cancellable child loading, a tree filter, and DN lookup navigation.
- `directory-search`: Filter-based search with validation and autocomplete, configurable base/scope/attributes/limits, results table, and recent-search history.
- `entry-editing`: Viewing and modifying entries: create, create from copy, attribute and value edits with change preview, rename/move, delete and subtree delete, and binary value handling.
- `app-shell`: Multi-pane application layout, light/dark theming, and the main/renderer process boundary (typed IPC) that all features run through.

### Modified Capabilities

_None. This is the initial change; no specs exist yet._

## Impact

- New codebase from scratch: Electron main process (LDAP sessions, schema service, profile and secret storage) and React renderer (Vite, Tailwind, shadcn/ui, TanStack Virtual).
- Dependencies: a pure-TypeScript LDAP client (e.g. `ldapts`); no native modules, so cross-platform packaging stays simple.
- Persistent data: connection profiles in the app's userData directory; secrets encrypted via the OS keychain facility.
- Still to be decided in design: target platforms and packaging, auto-update, and the integration-test setup (e.g. containerized OpenLDAP and 389-DS).
