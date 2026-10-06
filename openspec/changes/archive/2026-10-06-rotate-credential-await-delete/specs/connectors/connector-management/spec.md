## ADDED Requirements

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
