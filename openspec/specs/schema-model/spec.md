# schema-model Specification

## Purpose

Loads each connected server's schema and makes it available to the rest of the application, so that editing, search, and display behave according to the server's actual object classes and attribute types.

## Requirements

### Requirement: Load schema on connect
After a successful bind, the application SHALL locate the server's subschema entry through the root DSE and read its object class, attribute type, and syntax definitions. The schema SHALL be available to all features for the lifetime of the connection.

#### Scenario: OpenLDAP schema loaded
- **WHEN** the user connects to an OpenLDAP server
- **THEN** object classes such as "inetOrgPerson" and attribute types such as "mail" are known to the application

#### Scenario: Active Directory schema loaded
- **WHEN** the user connects to an Active Directory server
- **THEN** object classes such as "user" and attribute types such as "sAMAccountName" are known to the application

### Requirement: Reload schema
The user SHALL be able to reload the schema of an open connection without disconnecting.

#### Scenario: Schema changed on the server
- **WHEN** a new attribute type is added on the server and the user reloads the schema
- **THEN** the new attribute type is offered in autocomplete

### Requirement: Fallback when schema is unavailable
If the schema cannot be read, the connection SHALL stay usable. The application SHALL tell the user that schema-based assistance is unavailable, treat attributes as multi-valued text, and still treat well-known binary attributes and attributes using the ";binary" option as binary.

#### Scenario: Schema not readable by bind user
- **WHEN** the bind user has no read access to the subschema entry
- **THEN** browsing, searching, and editing still work, and a notice states that schema assistance is off for this connection

### Requirement: Object class information
For each object class, the schema model SHALL provide its names, OID, superior classes, kind (structural, auxiliary, or abstract), and required and allowed attributes including those inherited from superior classes.

#### Scenario: Inherited required attributes
- **WHEN** the application asks which attributes "inetOrgPerson" requires
- **THEN** the answer includes "cn" and "sn", inherited from "person", and "objectClass", inherited from "top"

### Requirement: Attribute type information
For each attribute type, the schema model SHALL provide its names and aliases, OID, superior type, syntax, whether it is single-valued, whether users can modify it, and whether it is binary.

#### Scenario: Single-valued attribute
- **WHEN** the application asks about "uidNumber" on a server that defines it as single-valued
- **THEN** the attribute is reported as single-valued

#### Scenario: Operational attribute
- **WHEN** the application asks about "modifyTimestamp"
- **THEN** the attribute is reported as not user-modifiable

### Requirement: Case-insensitive name and alias lookup
Object class and attribute type lookups SHALL be case-insensitive and SHALL accept any of the definition's names or its OID.

#### Scenario: Alias lookup
- **WHEN** the application looks up "CommonName"
- **THEN** it gets the same attribute type definition as for "cn"

### Requirement: Binary attribute detection
An attribute SHALL be treated as binary when its syntax is a binary syntax (such as Octet String, JPEG, Certificate, or Certificate List), when it is requested or returned with the ";binary" option, or when it is a well-known binary attribute of Active Directory such as "objectGUID" or "objectSid".

#### Scenario: Certificate attribute
- **WHEN** the application asks about "userCertificate"
- **THEN** the attribute is reported as binary

#### Scenario: Active Directory GUID
- **WHEN** the application asks about "objectGUID" on an Active Directory connection
- **THEN** the attribute is reported as binary

### Requirement: Allowed attributes for an entry
Given the object classes of an entry, the schema model SHALL provide the set of required attributes and the set of allowed optional attributes for that combination.

#### Scenario: Structural plus auxiliary class
- **WHEN** an entry has object classes "inetOrgPerson" and "posixAccount"
- **THEN** the required attributes include "uid", "uidNumber", "gidNumber", and "homeDirectory" in addition to those of "inetOrgPerson"
