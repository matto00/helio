# connector-management Specification

## MODIFIED Requirements

### Requirement: Connector CRUD lifecycle
The system SHALL allow an authenticated owner to create, read, list, update (non-secret
fields only), rotate the credential, and delete a Connector. A Connector created through the direct
authenticated create path SHALL still require a credential unless its auth type is `none`; that path SHALL
NOT be relaxed to express pendingness. A Connector MAY additionally be created in a *pending*,
credential-less state through the agent-initiated handoff path, and SHALL become usable only once a
credential is bound through the completion path.

#### Scenario: Create a Connector
- **WHEN** an authenticated user submits a name, kind (`rest_api` first), base host/URL, and
  credential value
- **THEN** the system persists a Connector owned by that user and returns its metadata,
  never the raw credential value

#### Scenario: Read and list return metadata only
- **WHEN** an authenticated user reads a single Connector or lists their Connectors
- **THEN** the response includes id, name, kind, base host/URL, timestamps, and a dependent
  count, and never includes the raw or ciphertext credential value

#### Scenario: Dependent count reflects referencing sources
- **WHEN** an authenticated user reads or lists a Connector that N `rest_api` data sources
  currently reference
- **THEN** the response's dependent count for that Connector equals N, updating as dependent
  sources are added or removed

#### Scenario: Update non-secret fields
- **WHEN** an authenticated owner submits a name or base host/URL change
- **THEN** the system updates those fields and leaves the stored credential untouched

#### Scenario: Update rejects a credential field
- **WHEN** an update request includes a credential/secret value
- **THEN** the system rejects the request rather than silently accepting or ignoring it

#### Scenario: Rotate a Connector's credential
- **WHEN** an authenticated owner submits a new credential value for their Connector via the
  dedicated rotation operation
- **THEN** the system encrypts and persists the new value, the Connector's dependents continue
  resolving auth via the same Connector id with the new value, and the response never echoes
  the new or old credential value

#### Scenario: Rotation fails closed when the master key is unconfigured
- **WHEN** a rotation request is submitted while no encryption master key is configured
- **THEN** the system rejects the request and leaves the existing credential untouched — no
  partial or plaintext write occurs

#### Scenario: Delete a Connector with no dependents
- **WHEN** an authenticated owner deletes a Connector that no data source references
- **THEN** the system deletes the Connector and its associated credential

#### Scenario: The direct create path still requires a credential
- **WHEN** an authenticated owner posts a Connector with an auth type other than `none` and no credential
- **THEN** the request is refused
- **AND** no Connector row is created

#### Scenario: A pending Connector is listed with its status
- **WHEN** an owner lists Connectors and one of them is pending
- **THEN** that entry is identified as pending
- **AND** the entry carries no credential value

#### Scenario: Credential rotation refuses a pending Connector
- **WHEN** the credential-rotation operation is invoked on a Connector that is pending
- **THEN** the request is refused with a 400-class error directing the caller to the completion path
- **AND** no credential is bound, so no outstanding completion token is left live against a usable Connector

#### Scenario: A pending Connector can be deleted by its owner
- **WHEN** an owner deletes a pending Connector
- **THEN** the Connector row is removed and its outstanding completion tokens are removed with it
- **AND** no credential binding is attempted

#### Scenario: Completion transitions a pending Connector to usable
- **WHEN** a credential is bound to a pending Connector through the completion path
- **THEN** subsequent reads no longer report it as pending
- **AND** it becomes acceptable to the source-creation and fetch paths
