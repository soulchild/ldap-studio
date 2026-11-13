# directory-search Specification

## Purpose

Lets users find entries with LDAP search filters, with help writing correct filters, and work with the results without leaving the application.

## Requirements

### Requirement: Search parameters
A search SHALL take a filter, a base DN, a scope (base, one level, or subtree), an optional list of attributes to return, and a size limit. The base DN SHALL default to the entry selected in the tree, or the tree root, and the scope SHALL default to subtree.

#### Scenario: Default base from selection
- **WHEN** the user opens the search view while "ou=people,dc=example,dc=com" is selected
- **THEN** the base DN is prefilled with "ou=people,dc=example,dc=com" and the scope is subtree

#### Scenario: Choose base from the directory
- **WHEN** the user browses for the base DN and chooses an entry in the dialog, found by expanding the tree or by searching all subtrees
- **THEN** that entry's DN becomes the base DN

### Requirement: Filter validation
The application SHALL check the filter syntax as the user types and SHALL point out the position of a syntax error. A search with an invalid filter SHALL NOT be sent to the server.

#### Scenario: Unbalanced parentheses
- **WHEN** the user types "(&(uid=jdoe)(mail=*)"
- **THEN** the filter field marks the missing closing parenthesis and the search action is disabled

#### Scenario: Unknown attribute warning
- **WHEN** the filter uses an attribute that is not in the server's schema
- **THEN** the filter field warns that the attribute is unknown but still allows running the search

### Requirement: Filter autocomplete
While typing a filter or the attribute list, the application SHALL suggest attribute names from the server's schema. When typing an "objectClass" value it SHALL suggest object class names.

#### Scenario: Attribute suggestion
- **WHEN** the user types "(ma" in the filter field
- **THEN** "mail" is among the suggestions

#### Scenario: Object class suggestion
- **WHEN** the user types "(objectClass=inet"
- **THEN** "inetOrgPerson" is among the suggestions

### Requirement: Paged, cancellable search
Searches SHALL fetch results in pages and show them as they arrive, up to the size limit. The user SHALL be able to cancel a running search, keeping the results received so far.

#### Scenario: Results stream in
- **WHEN** a subtree search matches 20,000 entries and the size limit is 50,000
- **THEN** the first results appear before the search finishes, and all 20,000 are listed when it completes

#### Scenario: Size limit reached
- **WHEN** a search matches more entries than the size limit
- **THEN** the results stop at the limit and a notice states that the limit was reached

#### Scenario: Cancel search
- **WHEN** the user cancels a running search
- **THEN** no further results are fetched and the results so far remain visible

### Requirement: Results table
Search results SHALL be shown in a table with the DN as the first column and one column per requested attribute. Multiple values SHALL be shown in one cell, and binary values SHALL be shown as a short description instead of raw bytes. The table SHALL support sorting by any column.

#### Scenario: Requested attributes become columns
- **WHEN** the user searches with attributes "cn, mail"
- **THEN** the results table has columns DN, cn, and mail

#### Scenario: Binary value in results
- **WHEN** a result has a "jpegPhoto" value
- **THEN** the cell shows a description such as "JPEG image, 12 KB" rather than raw bytes

### Requirement: Open result in editor
Activating a result row SHALL open that entry in the entry editor, and the user SHALL be able to reveal it in the tree.

#### Scenario: Open result
- **WHEN** the user clicks a result row
- **THEN** the entry editor shows that entry

### Requirement: Recent searches
The application SHALL remember the most recent searches per connection profile, including filter, base, scope, attributes, and size limit, and SHALL let the user rerun one. History SHALL persist across sessions and SHALL be limited to the 50 most recent entries per profile.

#### Scenario: Rerun a recent search
- **WHEN** the user selects a search from the recent list
- **THEN** all its parameters are filled in and the user can run it

#### Scenario: Duplicate searches
- **WHEN** the user runs the same search twice
- **THEN** the recent list contains it once, moved to the top

### Requirement: Search errors
Server errors during search SHALL be shown with the result code and diagnostic message, and results received before the error SHALL remain visible.

#### Scenario: Base DN does not exist
- **WHEN** the user searches with a base DN that does not exist
- **THEN** the application reports "no such object" for that base DN
