## MODIFIED Requirements

### Requirement: First terminal write wins

A run's terminal outcome SHALL be written only while the run is still non-terminal. If a reaped run's execution
later finishes, its outcome SHALL NOT overwrite the `failed` row, the pipeline's last-run fields, node snapshots,
history, alert state, or the rows of any dataset the pipeline writes back to. That late outcome SHALL be logged at WARN.

Whether the run is still open SHALL be checked inside the same database transaction as each node's snapshot,
history and payload write, and that check SHALL hold the run against a concurrent reap or pipeline delete until the
transaction commits. The run's own successful terminal write SHALL NOT count as the run being closed for this check.
A node write whose check finds the run finalized by anything else, or gone, SHALL write nothing for that node, and
no later node SHALL be written by that execution. The execution SHALL then publish no `succeeded` event, unless the
run's own `succeeded` terminal write had already won and the pipeline was deleted after it (see below).

This in-transaction guarantee covers node snapshots, history and payload history only. Alert evaluation, binary
references, the schema-drift baseline and Output schemas are protected only by the check made before the success
chain starts, so a reap landing after that check (which needs a heartbeat already older than the stale bound) can
still let those writes through.

A late finisher SHALL answer 404 (`Pipeline not found`) when its pipeline was deleted while it executed and before
its own `succeeded` terminal write committed, and 409 when its run was finalized by a reap while the pipeline still
exists.

Once a run's own `succeeded` terminal write has won, a later deletion of its pipeline SHALL NOT change the run's
answer: wherever that deletion lands relative to the run's remaining writes, the execution SHALL answer success and
publish exactly one `succeeded` event, after its remaining writes have settled. Writes for the deleted pipeline that
had not yet happened SHALL be skipped, never re-created; a failure of such a write SHALL NOT surface to the caller.
This applies only when the pipeline no longer exists: a failure of the success chain while the pipeline still exists
SHALL surface exactly as it would without a deletion.

#### Scenario: Stalled instance finishes after its run was reaped
- **WHEN** a run is reaped and its execution then succeeds
- **THEN** the run stays `failed`, and no snapshot, history or write-back dataset row is written by that execution
- **AND** the execution answers 409

#### Scenario: Reap lands after the early open-check but before a node's snapshot write
- **WHEN** a run passes the open-check before its success chain, and is then reaped before a materialized node's
  snapshot transaction begins
- **THEN** that node's snapshots, history and payload are not written, the run stays `failed`, no `succeeded` event
  is published, and the execution answers 409

#### Scenario: Healthy run whose own terminal write lands before its node writes
- **WHEN** a run that was never reaped has its own `succeeded` terminal write committed before some of its node
  snapshot writes
- **THEN** every materialized node's snapshots, history and payload are written, a `succeeded` event is published,
  and the run is `succeeded`

#### Scenario: Reap lands after the last node's write
- **WHEN** a run is reaped after its last materialized node was written but before its own terminal write
- **THEN** the run stays `failed`, no `succeeded` event is published, and the execution answers 409

#### Scenario: Reap attempted while a node's snapshot transaction is open
- **WHEN** a reap targets a run whose node snapshot transaction has already confirmed the run open
- **THEN** the reap waits until that transaction commits, and then finalizes the run as `failed`

#### Scenario: Pipeline deleted while its run executes
- **WHEN** a real run is admitted, its pipeline is deleted (cascading the run row) before the run's own `succeeded`
  terminal write commits, and the execution then succeeds
- **THEN** it answers 404 `Pipeline not found: <id>` and publishes no `succeeded` event, wherever the deletion lands
- **AND** this holds also when a later write of the success chain (for example a binary reference) fails because
  the pipeline is gone
- **AND** when the deletion lands before the early open-check, that execution writes nothing
- **AND** when it lands later, no node is written after the deletion; node snapshots and write-back rows already
  committed before it remain, as they do for any pipeline deletion, while history and payload rows go with the
  cascade

#### Scenario: Pipeline deleted after the run's own succeeded write won
- **WHEN** a real run's own `succeeded` terminal write commits, and its pipeline is then deleted before, between or
  after the run's node writes
- **THEN** the execution answers success and publishes exactly one `succeeded` event
- **AND** no node is written after the deletion is observed; node snapshots already committed before it remain, as
  they do for any pipeline deletion, while history and payload rows go with the cascade
- **AND** a later write that fails because the pipeline is gone (for example a binary reference) does not surface

#### Scenario: Success-chain failure while the pipeline still exists
- **WHEN** a run's own `succeeded` terminal write has won and a later write of its success chain fails while the
  pipeline still exists
- **THEN** that failure surfaces exactly as it does without any deletion
