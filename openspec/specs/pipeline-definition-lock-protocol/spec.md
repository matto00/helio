# pipeline-definition-lock-protocol Specification

## Purpose
The verified lock order that makes the draft save's stale-base check atomic against every writer of fingerprinted
pipeline state without introducing deadlocks.

## Requirements

### Requirement: G1 atomicity against every fingerprinted-state writer
Between the save's fingerprint read and its commit, no other transaction SHALL commit a change to the pipeline row,
its roots, steps, Outputs and their configs, schedule, the panels bound to its Outputs or the alert rules targeting
them. Each writer class SHALL have a two-connection race spec that is red when the protecting lock is removed.

#### Scenario: Writer racing a save
- **WHEN** a writer and a save run concurrently on the same pipeline
- **THEN** either the writer commits first and the save returns 409, or the writer waits or fails with a non-deadlock
  error after the save commits; never a lost update and never SQLSTATE `40P01`

### Requirement: G2 no deadlock with the system lock order
The save and every writer it requires to take the pipeline-row lock SHALL follow the VERIFIED order: `data_sources` rows
(source delete and teardown `FOR UPDATE`, root add `FOR KEY SHARE`), panels then dashboards (`lockForDeletion`, first and
once), the cycle advisory lock (only when an `upsertsource` ExistingSource edge is added or changed), the pipeline row
(`FOR NO KEY UPDATE`, through `hel1629_lock_pipelines`), alert rules by id, Outputs by (position, id).

#### Scenario: Concurrent mix
- **WHEN** a panel create, a pipeline delete, an Output delete, a source delete, a run's node-snapshot transaction and a
  save run concurrently, repeatedly
- **THEN** no transaction fails with SQLSTATE `40P01`

### Requirement: G3 journal completeness
The journaled prior definition SHALL equal the state the save replaced, including bound panel ids and alert rules.

#### Scenario: Panel bound during a save
- **WHEN** a panel binds to an Output while a save that deletes that Output is in flight
- **THEN** the save either sees it (422 or 409) or the bind fails after the save; the panel is never deleted unjournaled

### Requirement: Documented with evidence
The verified protocol SHALL be documented in `docs/live-draft-preview.md` §8.3 with the race, deadlock and
mutation evidence that supports each lock.

#### Scenario: Reviewer checks a lock
- **WHEN** a reviewer looks up why a writer takes the pipeline-row lock
- **THEN** the document names the race spec that is red without it
