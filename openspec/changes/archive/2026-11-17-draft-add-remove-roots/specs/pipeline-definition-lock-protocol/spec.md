## ADDED Requirements

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
