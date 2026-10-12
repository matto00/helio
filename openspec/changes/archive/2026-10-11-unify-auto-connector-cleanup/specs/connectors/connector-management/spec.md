## ADDED Requirements

### Requirement: Deleting a Connector removes its credential atomically
Deleting a Connector SHALL remove the Connector row and its credential row in a single transaction: either both are removed or neither is. Only a Connector owned by the deleting user SHALL be deleted, enforced by the delete itself as well as by the owner-scoped lookup before it.

#### Scenario: A failure removing the credential leaves the Connector intact
- **WHEN** deleting a Connector's credential row fails during a Connector delete
- **THEN** the delete reports failure
- **AND** the Connector row and its credential row both still exist, and the credential still resolves

#### Scenario: Another user's Connector is never deleted
- **WHEN** a user requests deletion of a Connector owned by a different user
- **THEN** that Connector and its credential row still exist
