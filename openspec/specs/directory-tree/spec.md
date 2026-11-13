# directory-tree Specification

## Purpose

Lets users browse a directory as a hierarchical tree that stays fast with very large containers, and jump directly to any entry by its DN.

## Requirements

### Requirement: Tree roots
For each open connection, the directory tree SHALL show the profile's base DN as its root, or one root per naming context when no base DN is set.

#### Scenario: Multiple naming contexts
- **WHEN** the server advertises two naming contexts and the profile has no base DN
- **THEN** the tree shows both naming contexts as root nodes

### Requirement: Load children on expand
The tree SHALL load an entry's children only when the user expands it. Loading children SHALL NOT fetch the children's full attribute sets.

#### Scenario: Expanding a node
- **WHEN** the user expands "ou=people,dc=example,dc=com"
- **THEN** its immediate children are listed by their RDN

#### Scenario: Leaf entries
- **WHEN** an entry has no children
- **THEN** after expanding it, the tree shows it as a leaf with no expand control

### Requirement: Paged loading of large containers
When a container has more children than the server returns in one response, the tree SHALL fetch them in pages and show each page as soon as it arrives, along with a running count of loaded children and an indicator while more are loading. All children SHALL be loaded, not only the first server-limited batch.

#### Scenario: Container larger than server size limit
- **WHEN** the user expands a container with 50,000 children on a server with a 1,000-entry response limit
- **THEN** the first children appear without waiting for the rest, the count rises as pages arrive, and all 50,000 children are eventually listed

#### Scenario: Server without paging support
- **WHEN** the server does not support paged results and returns a size-limit-exceeded result
- **THEN** the tree lists the children it received and shows a notice that the list is incomplete

### Requirement: Cancel loading
Loading a container's children SHALL stop when the user collapses that node, cancels it explicitly, or disconnects.

#### Scenario: Collapse while loading
- **WHEN** the user collapses a node whose children are still loading
- **THEN** no more pages are requested for that node and the node shows the children loaded so far as incomplete

### Requirement: Smooth scrolling with large trees
The tree SHALL remain smoothly scrollable and responsive to keyboard navigation when it contains at least 100,000 visible nodes.

#### Scenario: Scrolling a huge container
- **WHEN** a container with 100,000 loaded children is expanded
- **THEN** scrolling and moving the selection with arrow keys has no noticeable delay

### Requirement: Filter the tree
The directory pane SHALL offer a filter made of an attribute, an operator (contains, equals, starts with, ends with, exists, greater or equal, less or equal, sounds like) and a value. Applying it SHALL search the server below the selected entry, in its whole subtree or only its children as the user chooses, and SHALL show the matches with the entries leading to them in place of the tree until the filter is cleared. An empty attribute SHALL search the usual naming attributes.

#### Scenario: Filter by name
- **WHEN** "dc=example,dc=com" is selected and the user filters for names containing "jdoe" in the whole subtree
- **THEN** the pane shows "dc=example,dc=com", "ou=people" and "uid=jdoe", with "uid=jdoe" marked as the match

#### Scenario: Entries not loaded yet
- **WHEN** the user filters for "sn" equals "Bulk 04242" below "dc=example,dc=com" without having expanded "ou=bulk"
- **THEN** "cn=user04242" is shown below "ou=bulk"

#### Scenario: Only the children
- **WHEN** the user turns off the whole subtree and filters for "uid" equals "jdoe" below "dc=example,dc=com"
- **THEN** the pane says that no entries match directly below "dc=example,dc=com"

#### Scenario: Clear the filter
- **WHEN** the user picks a match and then clears the filter
- **THEN** the tree returns, opened to the picked entry and with it selected

### Requirement: Refresh a subtree
The user SHALL be able to refresh any node, which reloads its children from the server and keeps the expanded state of children that still exist.

#### Scenario: Entry added outside the application
- **WHEN** an entry is added on the server by another tool and the user refreshes its parent
- **THEN** the new entry appears in the tree

### Requirement: Select entry opens editor
Selecting an entry in the tree SHALL open it in the entry editor.

#### Scenario: Selecting an entry
- **WHEN** the user selects "cn=jdoe,ou=people,dc=example,dc=com"
- **THEN** the entry editor shows that entry's attributes

### Requirement: DN lookup
The application SHALL provide a Go to DN dialog, opened by a shortcut or from the command palette. Entering a DN SHALL open that entry in the editor and reveal it in the tree, expanding and loading ancestors as needed. DN comparison SHALL ignore case and insignificant whitespace.

#### Scenario: Jump to deep entry
- **WHEN** the user enters "cn=jdoe, ou=People, dc=example, dc=com" in the Go to DN dialog
- **THEN** the tree expands down to "cn=jdoe,ou=people,dc=example,dc=com", selects it, and the editor shows it

#### Scenario: DN does not exist
- **WHEN** the user enters a DN that does not exist on the server
- **THEN** the application reports that no such entry exists and names the closest existing ancestor

#### Scenario: Invalid DN syntax
- **WHEN** the user enters text that is not a valid DN
- **THEN** the dialog shows a syntax error and does not query the server

### Requirement: Copy DN
The user SHALL be able to copy the DN of any tree node to the clipboard.

#### Scenario: Copy from context menu
- **WHEN** the user chooses "Copy DN" on a tree node
- **THEN** the clipboard contains that node's full DN
