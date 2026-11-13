# Spec coverage

Each scenario in `openspec/specs` and the test or checklist item that covers it (task 14.4). The paths are shortened as follows:

- `e2e/` is `test/e2e/`.
- `int/` is an `*.int.test.ts` file under `src/main`.
- `unit/` is a `*.test.ts` file next to its source.
- `AD n.n` is an item in [`ad-checklist.md`](ad-checklist.md).

## App shell

| Scenario                             | Covered by                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Fresh machine without Java           | `test/package/launch.mjs` on installed packages: `linux-check.sh` (Debian container without Java) and the CI `package` job per OS   |
| Default layout on first launch       | e2e/layout › shows the directory above the connections, the editor and the bottom panel                                             |
| Collapsing the bottom panel          | e2e/layout › collapsing the bottom panel gives its space to the editor                                                              |
| Pane sizes are restored              | e2e/layout › pane sizes, the collapsed bottom panel and the window bounds persist across relaunch                                   |
| Following the system theme           | e2e/theme › in "match system" mode the window follows the OS appearance live                                                        |
| Explicit theme choice persists       | e2e/theme › choosing a theme in the menu switches the window and native UI, and persists                                            |
| Slow server does not freeze the UI   | e2e/responsiveness › a slow search leaves the tree and editor usable, and Stop keeps the results so far                             |
| Interface cannot read stored secrets | e2e/security › the renderer has no Node.js access; unit/profiles › never returns the password or its encrypted form to the renderer |
| Failed modify is logged              | int/session-lifecycle › records searches, reads and failed modifies with timing and result codes                                    |
| Bind password is redacted            | int/session-lifecycle › records the bind with the DN but never the password; e2e/log                                                |
| Jump to DN lookup                    | e2e/shortcuts › Cmd/Ctrl+L opens Go to DN with the field focused                                                                    |
| Run a command by typing              | e2e/shortcuts › Cmd/Ctrl+K opens the command palette, which runs a command with Enter; unit/commands › matchCommands                |
| Go to DN from the palette            | e2e/tree › DN lookup › opens with Cmd/Ctrl+L and from the command palette                                                           |

## Connection management

| Scenario                                     | Covered by                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Create a profile                             | e2e/connections › creates, edits, duplicates and deletes a profile; e2e/smoke                                                          |
| Delete a profile                             | e2e/connections › creates, edits, duplicates and deletes a profile; unit/profiles › deletes a profile together with its saved password |
| Duplicate a profile                          | e2e/connections › creates, edits, duplicates and deletes a profile; unit/profiles › duplicates settings                                |
| StartTLS refused                             | int/session › closes the connection when the server refuses StartTLS, without sending the bind                                         |
| Plain LDAP warning                           | e2e/connections › defaults the port to the encryption mode and warns about plain LDAP with a bind DN                                   |
| Custom CA                                    | int/session › transports; e2e/connections › tests a connection                                                                         |
| Untrusted certificate                        | e2e/connections › shows an untrusted certificate, trusts it, and reconnects without asking                                             |
| Trust and reconnect                          | e2e/connections › shows an untrusted certificate, trusts it, and reconnects without asking                                             |
| Certificate changes                          | int/session › rejects a different certificate when another fingerprint is pinned                                                       |
| Wrong password                               | e2e/connections › asks for a password, asks again after a wrong one; int/session › reports a wrong password                            |
| Anonymous bind                               | int/session › binds anonymously when the bind DN is empty                                                                              |
| Prompted password not saved                  | e2e/connections › asks again on the next connect when not saved                                                                        |
| Profile file contains no plain-text password | unit/profiles › never writes the password in plain text                                                                                |
| No secure storage available                  | unit/profiles › refuses to save a password without secure storage; unit/secrets › refuses to save when encryption is unavailable       |
| Test reports TLS failure                     | e2e/connections › tests a connection: success, a refused port and a certificate host name mismatch                                     |
| Two connections open                         | e2e/connections › connects two profiles at once and disconnects one                                                                    |
| Disconnect cancels running operations        | int/app › aborts a running stream when its connection is disconnected; unit/router › aborts the streams of a connection                |
| Server goes away                             | e2e/tree › keeps the loaded tree visible but read-only; int/session-lifecycle › reports a dropped connection                           |
| No base DN configured                        | e2e/tree › shows the naming context as root and loads children on expand                                                               |

## Directory tree

| Scenario                                | Covered by                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Multiple naming contexts                | unit/tree model › shows collapsed roots by their full DN (two naming contexts)                      |
| Expanding a node                        | e2e/tree › shows the naming context as root and loads children on expand                            |
| Leaf entries                            | e2e/tree › shows leaves without an expand control                                                   |
| Container larger than server size limit | e2e/tree › lists all 5,000 children of a large container, past the server size limit                |
| Server without paging support           | int/search › marks the result incomplete when a server without paging hits its size limit           |
| Collapse while loading                  | unit/tree store › cancels loading on collapse and keeps the children loaded so far                  |
| Scrolling a huge container              | e2e/tree › stays responsive with 100,000 nodes; unit/tree model › flattens 100,000 children quickly |
| Filter by name                          | e2e/tree › tree filter › finds entries by name below the selected entry; unit/quick-filter          |
| Entries not loaded yet                  | e2e/tree › tree filter › searches entries that were never loaded, by attribute                      |
| Only the children                       | e2e/tree › tree filter › searches only the children when the subtree is not included                |
| Clear the filter                        | e2e/tree › tree filter › finds entries by name … (clearing returns to the picked entry)             |
| Entry added outside the application     | e2e/tree › shows an entry added by another client after a refresh                                   |
| Selecting an entry                      | e2e/smoke; e2e/responsiveness (the editor follows the tree selection)                               |
| Jump to deep entry                      | e2e/tree › jumps to a deep entry, expanding and loading its ancestors                               |
| DN does not exist                       | e2e/tree › names the closest existing ancestor of a missing DN and goes there                       |
| Invalid DN syntax                       | e2e/tree › rejects invalid DN syntax without asking the server                                      |
| Copy from context menu                  | e2e/tree › copies a DN from the context menu and with Cmd/Ctrl+C                                    |

## Entry editing

| Scenario                                 | Covered by                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Viewing an entry                         | e2e/editor › shows the DN path, one row per value and the required attributes                                                       |
| Show operational attributes              | e2e/editor › shows operational attributes on request, read-only                                                                     |
| Stable attribute order                   | unit/editor model › orderAttributes; e2e/editor › lists objectClass, then required, then the rest, with operational attributes last |
| Add an allowed attribute                 | e2e/editor › suggests only attributes the object classes allow, and respects single values                                          |
| Single-valued attribute                  | e2e/editor › suggests only attributes the object classes allow, and respects single values                                          |
| Review before saving                     | e2e/editor › previews the changes and saves them as one modify; e2e/shortcuts › Cmd/Ctrl+S                                          |
| Discard changes                          | e2e/editor › changes, adds and removes values, marks them pending, and discards                                                     |
| Server rejects change                    | e2e/editor › shows a server rejection and keeps the pending changes                                                                 |
| Required attribute removed               | e2e/editor › blocks saving when a required attribute is removed                                                                     |
| Selecting another entry                  | e2e/editor › asks to save, discard or stay when another entry is selected                                                           |
| Concurrent change                        | e2e/editor › detects a concurrent change and reloads on request; AD 6.2                                                             |
| New person                               | e2e/actions › creates a person                                                                                                      |
| Structural class required                | e2e/actions › requires a structural object class                                                                                    |
| Copy a user entry                        | e2e/actions › copies the user attributes into a draft that is only created on save                                                  |
| Rename a user                            | e2e/actions › renames an entry, removing or keeping the old name                                                                    |
| Drag and drop                            | e2e/actions › moves an entry by drag and drop after confirming the old and new DN                                                   |
| Server refuses subtree move              | e2e/actions › shows a server refusal and leaves the tree unchanged                                                                  |
| Delete leaf                              | e2e/actions › deletes a leaf entry after confirmation                                                                               |
| Delete subtree                           | e2e/actions › deletes a subtree of 121 entries after stating the count; AD 4.2 (Tree Delete)                                        |
| Permission denied partway                | e2e/actions › reports how far a subtree delete got when permission is missing partway                                               |
| Edit other attribute of entry with photo | e2e/binary › leaves a binary value byte-identical when another attribute is saved                                                   |
| Certificate value                        | e2e/binary › shows an image as a thumbnail and a certificate decoded                                                                |
| Active Directory SID                     | unit/binary › formatSid; AD 3.2                                                                                                     |
| Replace photo                            | e2e/binary › replaces a value from a file and the server stores exactly its bytes                                                   |
| Save certificate to file                 | e2e/binary › saves a certificate to a file with exactly the stored bytes                                                            |
| Copy a value                             | e2e/editor › copies a value and all values of an attribute                                                                          |
| Choose a group member                    | e2e/editor › picks a member from the directory, starting at the current value; unit/schema model › DN attributes                    |

## Schema model

| Scenario                         | Covered by                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| OpenLDAP schema loaded           | int/schema service › loads the schema on connect and uses it for binary detection                     |
| Active Directory schema loaded   | unit/schema parse › parsing Active Directory specifics; unit/schema model › on the AD sample; AD 5.1  |
| Schema changed on the server     | int/schema service › picks up an attribute type added on the server                                   |
| Schema not readable by bind user | int/schema service › falls back without schema assistance when the account cannot read the schema     |
| Inherited required attributes    | unit/schema model › inherits required attributes along the superior chain of inetOrgPerson            |
| Single-valued attribute          | unit/schema model › reports value counts, modifiability and usage                                     |
| Operational attribute            | unit/schema model › reports value counts, modifiability and usage                                     |
| Alias lookup                     | unit/schema model › looks up names, aliases and OIDs case-insensitively                               |
| Certificate attribute            | int/schema service › loads the schema on connect and uses it for binary detection (`userCertificate`) |
| Active Directory GUID            | unit/schema model › detects objectGUID, objectSid and the security descriptor as binary               |
| Structural plus auxiliary class  | unit/schema model › combines a structural and an auxiliary class                                      |

## Directory search

| Scenario                            | Covered by                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Default base from selection         | e2e/search › defaults the base to the selected entry and the scope to subtree                                                   |
| Pick base from tree                 | e2e/search › picks the base DN in the tree                                                                                      |
| Unbalanced parentheses              | e2e/search › marks a syntax error and blocks the search; unit/filter                                                            |
| Unknown attribute warning           | e2e/search › warns about unknown attributes; unit/assist                                                                        |
| Attribute suggestion                | e2e/search › suggests attributes and object classes while typing                                                                |
| Object class suggestion             | e2e/search › suggests attributes and object classes while typing                                                                |
| Results stream in                   | e2e/search › lists 5,000 results past the server size limit; int/search › emitting pages as they arrive                         |
| Size limit reached                  | e2e/search › stops at the size limit and says so                                                                                |
| Cancel search                       | e2e/responsiveness › Stop keeps the results so far; unit/search store; int/search › stops after the current page when cancelled |
| Requested attributes become columns | e2e/search › lists 5,000 results … with the requested columns                                                                   |
| Binary value in results             | e2e/search › describes binary values instead of showing bytes                                                                   |
| Open result                         | e2e/search › opens a result in the editor and the tree                                                                          |
| Rerun a recent search               | e2e/search › remembers searches across restarts, once each, and fills the form from one                                         |
| Duplicate searches                  | e2e/search › remembers searches … once each; unit/history › keeps a repeated search once                                        |
| Base DN does not exist              | e2e/search › reports a missing base                                                                                             |
