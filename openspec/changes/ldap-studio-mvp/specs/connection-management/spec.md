# Spec Delta

## Purpose

Lets users define, store, and use connections to LDAP directory servers, including transport security, certificate trust, simple bind authentication, and secure storage of bind passwords.

## ADDED Requirements

### Requirement: Manage connection profiles
The user SHALL be able to create, edit, duplicate, and delete connection profiles. A profile SHALL hold a display name, host, port, transport security mode, bind DN, optional base DN, and certificate trust settings. Profiles SHALL persist across sessions.

#### Scenario: Create a profile
- **WHEN** the user creates a profile with name "prod", host "ldap.example.com", port 636, mode LDAPS, and a bind DN
- **THEN** the profile appears in the connections pane and is still present after relaunching the application

#### Scenario: Delete a profile
- **WHEN** the user deletes a profile and confirms
- **THEN** the profile and its saved password are removed

#### Scenario: Duplicate a profile
- **WHEN** the user duplicates a profile
- **THEN** a new profile with the same settings and a distinct name is created, without the saved password

### Requirement: Transport security modes
A profile SHALL support exactly three transport modes: plain LDAP, LDAPS (TLS from connect), and StartTLS. Default ports SHALL be 389 for plain LDAP and StartTLS and 636 for LDAPS. If a StartTLS upgrade fails, the application SHALL abort the connection and SHALL NOT fall back to plain LDAP.

#### Scenario: StartTLS refused
- **WHEN** the user connects with StartTLS and the server rejects the StartTLS request
- **THEN** the connection fails with an error stating that StartTLS was refused, and no bind is sent

#### Scenario: Plain LDAP warning
- **WHEN** the user saves a profile with plain LDAP and a bind DN
- **THEN** the profile editor shows a warning that credentials will be sent unencrypted

### Requirement: Certificate verification
For LDAPS and StartTLS, the application SHALL verify the server certificate against the operating system's trusted roots plus any CA certificates attached to the profile, and SHALL verify the hostname. A certificate that fails verification SHALL stop the connection unless it is trusted as described in "Trust a specific certificate".

#### Scenario: Custom CA
- **WHEN** a profile has a CA certificate attached and the server presents a certificate signed by that CA
- **THEN** the connection succeeds

#### Scenario: Untrusted certificate
- **WHEN** the server presents a self-signed certificate that is not trusted
- **THEN** the connection is stopped and the user sees the certificate's subject, issuer, validity period, and SHA-256 fingerprint along with the reason it failed

### Requirement: Trust a specific certificate
When verification fails, the user SHALL be able to trust that exact server certificate for the profile. The application SHALL store its SHA-256 fingerprint and accept only a certificate with that fingerprint on later connections.

#### Scenario: Trust and reconnect
- **WHEN** the user chooses to trust the presented certificate
- **THEN** the connection proceeds, and later connections with the same certificate succeed without asking

#### Scenario: Certificate changes
- **WHEN** a profile has a trusted fingerprint and the server later presents a different certificate that also fails verification
- **THEN** the connection is stopped and the user is told the certificate differs from the trusted one

### Requirement: Simple bind authentication
The application SHALL authenticate with simple bind using the profile's bind DN and password, or bind anonymously when the bind DN is empty. Bind failures SHALL be reported with the server's result code and diagnostic message.

#### Scenario: Wrong password
- **WHEN** the user connects with a wrong password
- **THEN** the connection fails with an "invalid credentials" error and the user is offered to enter the password again

#### Scenario: Anonymous bind
- **WHEN** a profile has no bind DN
- **THEN** the application binds anonymously

### Requirement: Password prompt
When a profile has a bind DN but no saved password, the application SHALL prompt for the password on connect. The prompt SHALL offer to save the password for the profile.

#### Scenario: Prompted password not saved
- **WHEN** the user enters the password in the prompt without choosing to save it
- **THEN** the connection uses the password, and the next connect after disconnecting prompts again

### Requirement: Secure password storage
Saved passwords SHALL be encrypted with the operating system's credential protection and SHALL never be written to disk in plain text. If the operating system offers no secure protection, the application SHALL refuse to save passwords and SHALL tell the user why.

#### Scenario: Profile file contains no plain-text password
- **WHEN** the user saves a profile with a password
- **THEN** the password does not appear in plain text in any file the application writes

#### Scenario: No secure storage available
- **WHEN** the user tries to save a password on a system without secure credential storage
- **THEN** the application does not save it and explains that the password will be requested on each connect

### Requirement: Test connection
The profile editor SHALL offer a "test connection" action that connects, performs the configured bind, and reports success or the specific failure (network, TLS, certificate, or bind) without saving the profile.

#### Scenario: Test reports TLS failure
- **WHEN** the user tests a profile whose server certificate hostname does not match
- **THEN** the test reports a certificate hostname mismatch

### Requirement: Connect and disconnect
The user SHALL be able to connect and disconnect each profile independently, and SHALL be able to have several connections open at the same time. The connections pane SHALL show each profile's state: disconnected, connecting, connected, or error.

#### Scenario: Two connections open
- **WHEN** the user connects to "prod" and then to "staging"
- **THEN** both are shown as connected and each has its own directory tree

#### Scenario: Disconnect cancels running operations
- **WHEN** the user disconnects while a search is running on that connection
- **THEN** the search is cancelled and the connection closes

### Requirement: Connection loss
When an open connection drops, the application SHALL mark it as disconnected, tell the user, and keep already loaded tree content visible but read-only until the user reconnects.

#### Scenario: Server goes away
- **WHEN** the server closes the connection unexpectedly
- **THEN** the profile is shown with an error state, editing actions are disabled, and a reconnect action is offered

### Requirement: Root DSE and naming contexts
After a successful bind, the application SHALL read the server's root DSE. It SHALL use the profile's base DN as the tree root if one is set, and otherwise the naming contexts the server advertises.

#### Scenario: No base DN configured
- **WHEN** the user connects with a profile that has no base DN and the server advertises "dc=example,dc=com"
- **THEN** the tree shows "dc=example,dc=com" as a root node
