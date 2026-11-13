# entry-editing Specification

## Purpose

Lets users view and change directory entries: edit attributes and values, create, copy, rename, move, and delete entries, and handle binary values safely, guided by the server's schema.

## Requirements

### Requirement: View entry
The entry editor SHALL show the entry's DN and all its user attributes with their values, one row per value. Operational attributes SHALL be hidden by default and shown on request. Attributes required by the entry's object classes SHALL be marked.

#### Scenario: Viewing an entry
- **WHEN** the user opens an "inetOrgPerson" entry
- **THEN** the editor lists "objectClass", "cn", "sn", and its other attributes, with "cn" and "sn" marked as required

#### Scenario: Show operational attributes
- **WHEN** the user turns on "show operational attributes"
- **THEN** attributes such as "createTimestamp" and "modifiersName" appear at the end of the list in a muted style, marked as read-only

### Requirement: Attribute order
Attributes SHALL appear in a fixed order regardless of the order the server returns them: "objectClass" first, then the required attributes, then the other attributes, then operational attributes, each group sorted alphabetically ignoring case. "objectClass" and required attributes SHALL be emphasized, and operational attributes SHALL be shown in a muted style.

#### Scenario: Stable attribute order
- **WHEN** the user opens an entry whose attributes the server returns in any order
- **THEN** "objectClass" comes first, then "cn" and "sn" (required), then the other attributes alphabetically

### Requirement: Edit attribute values
The user SHALL be able to change a value, add a value, add a new attribute, and remove a value or a whole attribute. Adding attributes SHALL offer autocomplete limited to the attributes the entry's object classes allow. Attributes that are not user-modifiable SHALL NOT be editable.

#### Scenario: Add an allowed attribute
- **WHEN** the user adds an attribute to an "inetOrgPerson" entry and types "tele"
- **THEN** "telephoneNumber" is suggested

#### Scenario: Single-valued attribute
- **WHEN** an attribute is single-valued and already has a value
- **THEN** the editor does not offer to add another value

### Requirement: Choose DN values
Values of attributes whose syntax is a DN (or Name and Optional UID) SHALL offer a dialog to choose an entry from the directory as a tree, opened at the current value when it names an entry. Choosing an entry SHALL set the value to its DN as a pending change; cancelling SHALL leave the value unchanged. Without a readable schema, well-known DN attributes such as "member" and "manager" SHALL offer it too.

#### Scenario: Choose a group member
- **WHEN** the user opens the chooser on the "member" value "uid=jdoe,ou=people,dc=example,dc=com" and chooses "uid=asmith"
- **THEN** the chooser opens with "uid=jdoe" selected, and the value becomes "uid=asmith,ou=people,dc=example,dc=com" as a pending change

### Requirement: Pending changes with preview
Edits SHALL remain pending until the user saves. The editor SHALL mark pending changes and SHALL let the user review them before saving as a list of the add, replace, and delete operations that will be sent. The user SHALL be able to discard all pending changes.

#### Scenario: Review before saving
- **WHEN** the user changes "mail" and removes "telephoneNumber", then chooses to save
- **THEN** a preview lists a replace for "mail" and a delete for "telephoneNumber", and nothing is sent until the user confirms

#### Scenario: Discard changes
- **WHEN** the user discards pending changes
- **THEN** the entry shows its values as last loaded from the server

### Requirement: Atomic save
All pending changes to an entry SHALL be sent as a single modify operation, so the server applies either all of them or none. On failure, the pending changes SHALL be kept and the server's error SHALL be shown.

#### Scenario: Server rejects change
- **WHEN** a save violates a schema rule on the server
- **THEN** no change is applied, the server's diagnostic message is shown, and the pending changes remain for correction

### Requirement: Schema checks before saving
Before saving, the editor SHALL check that all required attributes have a value and that single-valued attributes have at most one value, and SHALL block saving with a clear message if a check fails.

#### Scenario: Required attribute removed
- **WHEN** the user removes the only value of "sn" from an "inetOrgPerson" entry
- **THEN** saving is blocked and the editor states that "sn" is required

### Requirement: Navigating away with pending changes
When the user selects another entry or closes the editor while changes are pending, the application SHALL ask whether to save, discard, or stay.

#### Scenario: Selecting another entry
- **WHEN** the user has pending changes and selects another entry in the tree
- **THEN** the application asks to save, discard, or cancel the selection

### Requirement: Stale entry detection
When saving, if the entry was changed on the server after it was loaded, the application SHALL warn the user and offer to reload the entry or overwrite it with the pending changes.

#### Scenario: Concurrent change
- **WHEN** another tool changes the entry after it was opened and the user saves
- **THEN** the user is warned that the entry changed on the server and can choose to reload or overwrite

### Requirement: Create entry
The user SHALL be able to create a child entry under any entry by choosing object classes and an RDN. The editor SHALL then show all attributes required by the chosen classes, with the RDN attribute already filled in, and SHALL create the entry only when the schema checks pass.

#### Scenario: New person
- **WHEN** the user creates an entry under "ou=people" with object class "inetOrgPerson" and RDN "cn=Jane Doe"
- **THEN** the editor shows "cn" with "Jane Doe" and an empty required "sn", and creation is possible once "sn" is filled

#### Scenario: Structural class required
- **WHEN** the user selects only auxiliary object classes
- **THEN** the dialog states that a structural object class is required

### Requirement: Create from copy
The user SHALL be able to create a new entry by copying an existing entry's object classes and user attributes, choosing a new RDN and optionally a different parent. Operational attributes SHALL NOT be copied.

#### Scenario: Copy a user entry
- **WHEN** the user copies "cn=jdoe,ou=people" with new RDN "cn=jsmith"
- **THEN** a new entry editor opens with jdoe's attributes, "cn" set to "jsmith", and nothing is created until the user saves

### Requirement: Rename entry
The user SHALL be able to change an entry's RDN, choosing whether the old RDN value is kept as an attribute value. Entries with children SHALL be renamed if the server allows it.

#### Scenario: Rename a user
- **WHEN** the user renames "cn=jdoe,ou=people" to "cn=john.doe" and chooses not to keep the old value
- **THEN** the entry's DN becomes "cn=john.doe,ou=people" and "jdoe" is no longer a "cn" value

### Requirement: Move entry
The user SHALL be able to move an entry to a new parent, either through a move action with a parent picker or by dragging it onto another node in the tree. Every move SHALL require confirmation that shows the old and new DN.

#### Scenario: Drag and drop
- **WHEN** the user drags "cn=jdoe,ou=people" onto "ou=former"
- **THEN** a confirmation shows the old DN and the new DN "cn=jdoe,ou=former", and the move happens only after confirmation

#### Scenario: Server refuses subtree move
- **WHEN** the server does not allow moving an entry that has children
- **THEN** the application shows the server's error and the tree is unchanged

### Requirement: Delete entry
The user SHALL be able to delete an entry after confirming. Deleting an entry with children SHALL require a separate confirmation that states the number of entries that will be deleted.

#### Scenario: Delete leaf
- **WHEN** the user deletes a leaf entry and confirms
- **THEN** the entry is removed from the server and the tree

#### Scenario: Delete subtree
- **WHEN** the user deletes "ou=temp" which has 120 descendants
- **THEN** the confirmation states that 121 entries will be deleted, and after confirming all are removed

### Requirement: Subtree delete progress and failure
A subtree delete SHALL show progress and SHALL be cancellable. If it stops partway, because of an error or cancellation, the application SHALL report how many entries were deleted and which entry failed, and SHALL refresh the tree.

#### Scenario: Permission denied partway
- **WHEN** a subtree delete reaches an entry the bind user may not delete
- **THEN** the delete stops, the user sees the number of deleted entries and the failing DN, and the tree reflects what remains

### Requirement: Binary values are preserved exactly
Binary attribute values SHALL be read and written as raw bytes and SHALL never be changed by text conversion. Saving an entry SHALL leave untouched binary values byte-for-byte identical.

#### Scenario: Edit other attribute of entry with photo
- **WHEN** the user changes "mail" on an entry that has a "jpegPhoto" and saves
- **THEN** the "jpegPhoto" value on the server is byte-for-byte unchanged

### Requirement: Binary value display
The editor SHALL show binary values by type: images as thumbnails, X.509 certificates as subject, issuer, validity, and serial number, Active Directory "objectGUID" and "objectSid" in their standard string forms, and other binary values as size plus a hex preview.

#### Scenario: Certificate value
- **WHEN** an entry has a "userCertificate" value
- **THEN** the editor shows the certificate's subject, issuer, and expiry date

#### Scenario: Active Directory SID
- **WHEN** an Active Directory entry is opened
- **THEN** its "objectSid" is shown in the form "S-1-5-21-..."

### Requirement: Binary value import and export
For each binary value the user SHALL be able to save it to a file and replace it with the contents of a file. For binary attributes the user SHALL be able to add a value from a file.

#### Scenario: Replace photo
- **WHEN** the user replaces a "jpegPhoto" value with a file and saves
- **THEN** the server stores exactly the file's bytes

#### Scenario: Save certificate to file
- **WHEN** the user saves a "userCertificate" value to a file
- **THEN** the file contains exactly the stored bytes

### Requirement: Password values are not shown
For "userPassword" the editor SHALL show only each value's hash method, never the value, and SHALL offer no file import or export.

#### Scenario: Hashed password
- **WHEN** an entry with a "{SSHA}" password is opened
- **THEN** the value reads "SSHA password"

### Requirement: Set password values
The user SHALL set a "userPassword" value in a dialog that takes the new password twice, hashes it with a chosen method, and previews the value to be stored. The methods SHALL be SSHA-512 (the default), SSHA-384, SSHA-256, SSHA, SHA-512, SHA-384, SHA-256, SHA, PKCS5S2, and Plaintext; the editor SHALL NOT check which of them the server supports. Setting a password SHALL be a pending change like any other edit.

#### Scenario: Set a new password
- **WHEN** the user sets a "userPassword" value to a new password with SSHA and saves
- **THEN** the server stores a "{SSHA}" value and accepts a bind with the new password

#### Scenario: Passwords do not match
- **WHEN** the confirmation differs from the new password
- **THEN** the dialog says so and the password cannot be set

#### Scenario: Add a password
- **WHEN** the user adds "userPassword" to an entry
- **THEN** the password dialog opens, and cancelling it adds nothing

### Requirement: Copy values
The user SHALL be able to copy a text value, or an attribute with all its values, to the clipboard.

#### Scenario: Copy a value
- **WHEN** the user chooses "Copy value" on a "mail" value
- **THEN** the clipboard contains that value
