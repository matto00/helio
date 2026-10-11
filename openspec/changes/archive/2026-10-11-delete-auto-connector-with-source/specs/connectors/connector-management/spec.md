## ADDED Requirements

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

## MODIFIED Requirements

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
