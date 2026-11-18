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

### Requirement: Root writes inside a draft save follow order O*
A draft save that adds roots SHALL take `FOR KEY SHARE` on each added source row, in id order, before every other lock,
and SHALL take the cycle advisory lock before the pipeline row. A save that removes roots SHALL lock the panels the
removal can delete in step (1). The fingerprint SHALL still be compared after every lock is held, and a re-plan on the
locked state that needs a lock the pre-lock plan did not take SHALL answer 409 `PATCH_SET_STALE` instead of locking out
of order.

#### Scenario: A source delete racing a root-adding save
- **WHEN** a source delete and a draft save that adds that source as a root run concurrently
- **THEN** the two serialise on the source row: the outcome equals one of the two serial orders (the delete's existing
  semantics applied to the saved root, or the save answering an error with nothing written), no root is left on a deleted
  source, and no deadlock (`40P01`) is raised

#### Scenario: A root add racing a draft save
- **WHEN** `POST /api/pipelines/:id/roots` commits while a draft save is parked after its fingerprint compare
- **THEN** the root add waits for the save, or the save answers 409 with nothing written; never both commit as a lost
  update
