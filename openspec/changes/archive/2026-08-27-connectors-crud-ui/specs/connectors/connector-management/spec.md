## MODIFIED Requirements

### Requirement: Connector CRUD lifecycle
The system SHALL allow an authenticated owner to create, read, list, update (non-secret
fields only), rotate the credential, and delete a Connector.

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

### Requirement: Ownership and access control mirror data sources
The system SHALL scope every Connector to a single owner using the same ownership/RLS model
already used for `data_sources`, granting no implicit cross-user access.

#### Scenario: A user cannot read another user's Connector
- **WHEN** an authenticated user requests a Connector id owned by a different user
- **THEN** the system returns not-found, not the other user's data

#### Scenario: A user cannot list another user's Connectors
- **WHEN** an authenticated user lists Connectors
- **THEN** the response contains only Connectors that user owns

#### Scenario: A user cannot rotate another user's Connector credential
- **WHEN** an authenticated user submits a rotation request for a Connector id owned by a
  different user
- **THEN** the system returns not-found and performs no write

### Requirement: Deleting a Connector with dependent sources is blocked
The system SHALL refuse to delete a Connector that is still referenced by a dependent
resource, rather than silently orphaning or cascading the reference. A `rest_api` data source
whose config references the Connector's id counts as a dependent.

#### Scenario: Delete blocked while dependents exist
- **WHEN** an authenticated owner attempts to delete a Connector that a `rest_api` data source
  still references
- **THEN** the system rejects the deletion with a clear, actionable error (409) rather than
  deleting the Connector or silently leaving a dangling reference, and performs no deletion

#### Scenario: Delete succeeds once the last dependent is removed
- **WHEN** an authenticated owner deletes the last `rest_api` data source referencing a
  Connector, then attempts to delete that Connector
- **THEN** the deletion succeeds
