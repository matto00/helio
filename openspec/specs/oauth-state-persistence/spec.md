# oauth-state-persistence Specification

## Purpose
Durable, cross-instance storage for short-lived OAuth CSRF state values, so that any serving process
can validate a state issued by any other process, exactly once, within a bounded lifetime.

## Requirements

### Requirement: OAuth state is stored outside process memory

The system SHALL persist each issued OAuth CSRF state in shared, durable storage that is visible to
every serving process, rather than in the memory of the process that issued it. Issuing a state and
consuming it SHALL NOT require that the two operations be served by the same process, and SHALL NOT
be affected by a process starting or terminating between the two operations.

#### Scenario: State issued by one process is consumed by a different process

- **WHEN** a state is issued through one state store instance backed by the shared storage
- **AND** that state is presented for validation through a **separate, independently constructed**
  state store instance backed by the same shared storage, holding no in-memory state in common with
  the issuing instance
- **THEN** validation succeeds

#### Scenario: State survives the loss of the issuing process

- **WHEN** a state is issued and the issuing state store instance is discarded entirely
- **AND** a newly constructed state store instance validates that state
- **THEN** validation succeeds

### Requirement: A state is valid at most once

The system SHALL consume a state atomically on validation: the first validation of a given state
SHALL succeed and every subsequent validation of that same state SHALL fail. Concurrent validations
of the same state SHALL result in at most one success.

#### Scenario: Replayed state is rejected

- **WHEN** a state is issued and validated successfully
- **AND** the same state value is presented for validation a second time
- **THEN** the second validation fails

#### Scenario: Concurrent validation of one state yields a single success

- **WHEN** the same state value is presented for validation concurrently by multiple callers
- **THEN** exactly one validation succeeds and all others fail

### Requirement: Unknown and expired states are rejected

The system SHALL reject a state value that was never issued. The system SHALL reject a state whose
lifetime has elapsed. The state lifetime SHALL be 300 seconds (5 minutes), unchanged from the prior
in-memory store.

#### Scenario: Forged state is rejected

- **WHEN** a state value that the system never issued is presented for validation
- **THEN** validation fails

#### Scenario: Expired state is rejected

- **WHEN** a state was issued more than 300 seconds ago and is presented for validation
- **THEN** validation fails

#### Scenario: State within its lifetime is accepted

- **WHEN** a state was issued less than 300 seconds ago and has not been consumed
- **THEN** validation succeeds

### Requirement: Expired state records are pruned

The system SHALL remove expired state records so that stored state does not accumulate without
bound. Pruning SHALL NOT remove a record that is still within its lifetime and has not been consumed.

#### Scenario: Pruning removes only expired records

- **WHEN** pruning runs while both an expired state and an unexpired unconsumed state are stored
- **THEN** the expired record is removed
- **AND** the unexpired state still validates successfully afterwards

### Requirement: State values are never logged

The system SHALL NOT write an OAuth state value, an OAuth authorization code, or a session token to
any log at any level.

#### Scenario: Failed validation logs no state value

- **WHEN** validation of a state fails for any reason
- **THEN** no log record emitted by the system contains the state value
