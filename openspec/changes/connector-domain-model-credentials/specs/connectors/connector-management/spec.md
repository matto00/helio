## Purpose

A Connector is a saved, reusable, owner-scoped credentialed host (base URL/host + auth
material) that many data sources can later reference, instead of each source re-entering its
own copy of a credential.

## ADDED Requirements

### Requirement: Connector CRUD lifecycle
The system SHALL allow an authenticated owner to create, read, list, update (non-secret
fields only), and delete a Connector.

#### Scenario: Create a Connector
- **WHEN** an authenticated user submits a name, kind (`rest_api` first), base host/URL, and
  credential value
- **THEN** the system persists a Connector owned by that user and returns its metadata,
  never the raw credential value

#### Scenario: Read and list return metadata only
- **WHEN** an authenticated user reads a single Connector or lists their Connectors
- **THEN** the response includes id, name, kind, base host/URL, and timestamps, and never
  includes the raw or ciphertext credential value

#### Scenario: Update non-secret fields
- **WHEN** an authenticated owner submits a name or base host/URL change
- **THEN** the system updates those fields and leaves the stored credential untouched

#### Scenario: Update rejects a credential field
- **WHEN** an update request includes a credential/secret value
- **THEN** the system rejects the request rather than silently accepting or ignoring it

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

### Requirement: Deleting a Connector with dependent sources is blocked
The system SHALL refuse to delete a Connector that is still referenced by a dependent
resource, rather than silently orphaning or cascading the reference.

#### Scenario: Delete blocked while dependents exist
- **WHEN** an authenticated owner attempts to delete a Connector that a dependent resource
  still references
- **THEN** the system rejects the deletion with a clear, actionable error rather than
  deleting the Connector or silently leaving a dangling reference
