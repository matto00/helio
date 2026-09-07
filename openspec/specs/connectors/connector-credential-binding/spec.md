# connectors/connector-credential-binding Specification

## Purpose
Defines how a Connector's credential is stored, protected, and recovered — the read-path
contract that makes it safe to persist real API keys and passwords server-side.

## Requirements

### Requirement: Credential encrypted at rest
The system SHALL store a Connector's credential value only in encrypted form; the raw
plaintext value SHALL NOT be persisted anywhere. This SHALL hold identically whether the credential is
supplied at Connector creation, through credential rotation, or through the out-of-band completion path for
a pending Connector — the completion path SHALL reuse the same encrypted write rather than introducing its
own.

#### Scenario: Stored bytes are not the plaintext
- **WHEN** a Connector is created with a credential value
- **THEN** querying the underlying storage directly for that credential's row returns bytes
  that are not the plaintext value, do not contain it as a substring, and are not a trivial
  reversible encoding of it (e.g. base64)

#### Scenario: A credential supplied through completion is encrypted by the same path
- **WHEN** a credential is bound to a pending Connector through the completion path
- **THEN** it is persisted through the same envelope-encrypted write used at creation
- **AND** querying the underlying storage directly returns bytes that are not the plaintext and do not
  contain it as a substring

#### Scenario: Encryption failure during completion leaves the Connector pending
- **WHEN** the encryption step fails while completing a pending Connector
- **THEN** the request is refused, no credential row is bound, and the Connector remains pending

### Requirement: No read path returns the raw credential
The system SHALL NOT return a Connector's raw or decrypted credential value from any
client-facing read path. This SHALL include the pending-Connector status path and the completion path's own
responses, neither of which SHALL echo a supplied or stored credential value.

#### Scenario: REST get/list never includes the raw value
- **WHEN** a client calls the REST API to read or list Connectors
- **THEN** no field in the response contains the raw credential value in any form

#### Scenario: Every other read-shaped path is equally checked
- **WHEN** any other caller-facing surface that can read Connector data is exercised (e.g. an
  MCP tool, a preview/test endpoint)
- **THEN** it is confirmed, the same as the REST path, to never return the raw credential value

#### Scenario: The completion response does not echo the supplied credential
- **WHEN** a human successfully supplies a credential through the completion path
- **THEN** the response confirms completion
- **AND** the response does not contain the submitted value

### Requirement: Credential is recoverable for outbound use only
The system SHALL be able to recover a Connector credential's plaintext value internally, for
the sole purpose of authenticating an outbound request made on the owner's behalf, via a path
distinct from any client-facing read.

#### Scenario: Outbound request authenticates using the stored credential
- **WHEN** the system makes an outbound request to a host using a stored Connector's
  credential
- **THEN** the request authenticates successfully against a real endpoint that validates
  that exact credential value

### Requirement: Encryption failure is fail-closed
The system SHALL refuse to persist a Connector credential if the encryption step fails (e.g.
no encryption key configured), rather than storing it unencrypted or partially written.

#### Scenario: Missing key blocks credential creation
- **WHEN** the underlying encryption key is not configured and a Connector create request
  includes a credential value
- **THEN** the system fails the request and persists no Connector row and no credential row
