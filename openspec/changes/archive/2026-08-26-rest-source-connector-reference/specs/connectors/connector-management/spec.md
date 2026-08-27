## MODIFIED Requirements

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
