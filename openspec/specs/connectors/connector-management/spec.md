# connectors/connector-management Specification

## Purpose
A Connector is a saved, reusable, owner-scoped credentialed host (base URL/host + auth
material) that many data sources can later reference, instead of each source re-entering its
own copy of a credential.

## Requirements

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
whose config references the Connector's id counts as a dependent. A source delete MAY itself remove an unadopted
auto-created Connector once its last dependent is gone (see "Deleting a source removes its unadopted auto-created
Connector"); every other Connector outlives its sources until the owner deletes it.

#### Scenario: Delete blocked while dependents exist
- **WHEN** an authenticated owner attempts to delete a Connector that a `rest_api` data source
  still references
- **THEN** the system rejects the deletion with a clear, actionable error (409) rather than
  deleting the Connector or silently leaving a dangling reference, and performs no deletion

#### Scenario: Delete succeeds once the last dependent is removed
- **WHEN** an authenticated owner deletes the last `rest_api` data source referencing a
  user-created Connector, then attempts to delete that Connector
- **THEN** the deletion succeeds

### Requirement: A Connector base URL is validated against the egress policy
Creating or updating a Connector SHALL validate its `baseUrl` against the shared egress policy
(`outbound-egress-guard`) in addition to the existing non-empty check, and SHALL refuse the request with a 400-class
error when the base URL's scheme is not permitted or its host resolves to a disallowed address. A disallowed base URL
SHALL NOT be persisted.

This create-time check SHALL NOT be the only guard: because a hostname's resolution can change after the row is
stored, the fetch-time guard remains authoritative, and a stored Connector that later resolves to a disallowed address
SHALL still be refused at fetch time.

#### Scenario: Each blocked address class is refused at create
- **WHEN** a Connector is created with a `baseUrl` whose host resolves to a loopback address
- **THEN** the response is a 400-class error naming the disallowed address, and no Connector row is created
- **AND** the same holds independently for a link-local address and for an RFC1918 private address

#### Scenario: The metadata endpoint cannot be stored
- **WHEN** a Connector is created with `baseUrl` of `http://169.254.169.254/`
- **THEN** the request is refused and nothing is persisted

#### Scenario: An update cannot introduce a disallowed base URL
- **WHEN** an existing Connector is updated with a `baseUrl` resolving to a private address
- **THEN** the update is refused and the stored row is unchanged

#### Scenario: A legitimate external base URL is still accepted
- **WHEN** a Connector is created with a public HTTPS `baseUrl`
- **THEN** it is created exactly as before this change

#### Scenario: A previously stored disallowed base URL is refused at fetch time
- **WHEN** a Connector row exists whose base URL resolves to a disallowed address
- **THEN** a fetch using it is refused, independently of whether it passed validation when it was stored

### Requirement: Credential rotation retires the old credential atomically
When credential rotation reports success, the Connector SHALL be bound to the new credential AND the previously bound
credential SHALL already be removed, so that it can no longer be resolved or decrypted by any path. Rotation SHALL be
all-or-nothing: if any part of it fails (persisting the new credential, rebinding the Connector, or removing the old
credential), the system SHALL report failure and leave the Connector bound to its original, still-resolvable
credential, with no new credential left behind.

#### Scenario: The old credential is unresolvable as soon as rotation succeeds
- **WHEN** an owner rotates their Connector's credential and the rotation reports success
- **THEN** an immediate lookup or decrypt of the previously bound credential returns nothing
- **AND** the Connector resolves the new credential value

#### Scenario: A failure removing the old credential fails the whole rotation
- **WHEN** removing the previously bound credential fails during rotation
- **THEN** the rotation reports failure
- **AND** the Connector is still bound to its original credential, which still resolves to its original value
- **AND** no newly minted credential remains stored

### Requirement: Deleting a source removes its unadopted auto-created Connector
When an owner deletes a `rest_api` data source, the system SHALL also delete the Connector that source referenced,
together with that Connector's credential row, if and only if all of these hold once the source is gone:
- the Connector is auto-created: its server-owned `implicit` flag is `true`;
- the Connector is unadopted: its name still starts with `Auto: `;
- no other data source references the Connector.

Renaming the source SHALL NOT prevent the cleanup. Only a Connector owned by the deleting user SHALL ever be deleted.
The source delete's response SHALL be unchanged. A failure to delete the Connector SHALL be logged using identifiers
only, and SHALL NOT fail, roll back or alter the source delete. No credential value SHALL be logged.

#### Scenario: Deleting a bare-url REST source removes its Auto Connector and credential
- **WHEN** an owner deletes a `rest_api` source created from a bare `url`, and no other source references its
  `Auto: <name>` Connector
- **THEN** the delete returns success, and that Connector and its credential row no longer exist

#### Scenario: Auto Connector reused by another source is kept until its last source is deleted
- **WHEN** a second source references the same auto-created Connector and the first source is deleted
- **THEN** the Connector and its credential still exist
- **WHEN** the second source is then deleted
- **THEN** the Connector and its credential row no longer exist

#### Scenario: A renamed Auto Connector is treated as adopted and kept
- **WHEN** the owner renamed the auto-created Connector so its name no longer starts with `Auto: `, and then deletes
  its only source
- **THEN** the Connector and its credential still exist

#### Scenario: Renaming the source does not block cleanup
- **WHEN** the owner renamed a bare-url REST source and then deletes it
- **THEN** its still-`Auto: `-named auto-created Connector and credential row no longer exist

#### Scenario: A user-created Connector is never removed by a source delete
- **WHEN** an owner deletes the only `rest_api` source referencing a Connector they created themselves, even one they
  named starting with `Auto: `
- **THEN** the Connector and its credential still exist

#### Scenario: Connector cleanup failure does not fail the source delete
- **WHEN** the Connector delete fails after the source was deleted
- **THEN** the source delete still returns success, and the failure is logged without any credential value
