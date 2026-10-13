## MODIFIED Requirements

### Requirement: First terminal write wins

A run's terminal outcome SHALL be written only while the run is still non-terminal. If a reaped run's execution
later finishes, its outcome SHALL NOT overwrite the `failed` row, the pipeline's last-run fields, node snapshots,
history, alert state, or the rows of any dataset the pipeline writes back to. That late outcome SHALL be logged at WARN.

Whether the run is still open SHALL be checked inside the same database transaction as each node's snapshot,
history and payload write, and that check SHALL hold the run against a concurrent reap or pipeline delete until the
transaction commits. The run's own successful terminal write SHALL NOT count as the run being closed for this check.
A node write whose check finds the run finalized by anything else, or gone, SHALL write nothing for that node, and
the execution SHALL publish no `succeeded` event.

This in-transaction guarantee covers node snapshots, history and payload history only. Alert evaluation, binary
references, the schema-drift baseline and Output schemas are protected only by the check made before the success
chain starts, so a reap landing after that check (which needs a heartbeat already older than the stale bound) can
still let those writes through.

A late finisher SHALL answer 404 (`Pipeline not found`) when its pipeline was deleted while it executed, and 409 when
its run was finalized by a reap while the pipeline still exists.

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
- **WHEN** a real run is admitted, its pipeline is deleted (cascading the run row), and the execution then succeeds
- **THEN** it answers 404 `Pipeline not found: <id>` and publishes no `succeeded` event, wherever the deletion lands
- **AND** when the deletion lands before the early open-check, that execution writes nothing
- **AND** when it lands later, no node is written after the deletion; node snapshots and write-back rows already
  committed before it remain, as they do for any pipeline deletion, while history and payload rows go with the
  cascade
