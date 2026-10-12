## Purpose

Detects real pipeline runs whose executing process died, and finalizes them as failed. A crashed run then no longer
blocks the pipeline's auto-runs, schedules and hooks, and stops holding a slot in the owner's concurrency cap.

## ADDED Requirements

### Requirement: Executing runs carry a liveness heartbeat

The system SHALL stamp a liveness heartbeat on every non-terminal real run, at least every 30 seconds, for as long
as the server instance executing it is alive. A run SHALL receive an initial heartbeat when it is admitted. The
heartbeat cadence SHALL NOT depend on the scheduler tick, so a long scheduled run cannot stall its own heartbeat.

#### Scenario: Long run keeps a fresh heartbeat
- **WHEN** a real run executes for longer than the staleness bound on a live instance
- **THEN** its heartbeat is never older than the stamping interval plus one stamp's latency

### Requirement: Stale non-terminal runs are reaped as failed

On every scheduler tick, before due schedules and pending auto-runs are processed, the system SHALL mark as failed
every non-terminal run whose heartbeat is older than `PIPELINE_RUN_STALE_AFTER_SECONDS`. The default bound SHALL be
600 seconds. A value that is not numeric, or that is below three heartbeat intervals, SHALL fall back to the default
with a WARN. A run that has never had a heartbeat SHALL be reaped only when its start is more than 1 hour old.

A reaped run SHALL get status `failed`, a completion time, and an error message stating that it was abandoned
because its heartbeat went stale. When the reaped run is the pipeline's latest real run, the pipeline's last-run
status SHALL become `failed`. Each reaped run SHALL produce one WARN log line naming the pipeline, the run, the
owner and the run's age. Each reaped run SHALL also publish a terminal `failed` run-status event.

#### Scenario: Orphaned run stops blocking the pipeline
- **WHEN** a run's process died with the run non-terminal, and its heartbeat is older than the bound
- **THEN** the next tick marks it failed, and on that same tick a due schedule or pending auto-run for the pipeline
  fires
- **AND** the run no longer counts against the owner's concurrency cap

#### Scenario: Live long run is never reaped
- **WHEN** a run has executed for hours but its heartbeat is fresh
- **THEN** no tick reaps it, and it later completes with its real outcome

#### Scenario: Legacy run without a heartbeat
- **WHEN** a non-terminal run has no heartbeat and started 30 minutes ago
- **THEN** it is not reaped
- **AND WHEN** it started more than 1 hour ago **THEN** it is reaped

### Requirement: Reaping is safe across instances

Reaping SHALL be atomic per run. Concurrent reaper passes on several instances SHALL finalize each stale run exactly
once. A run whose heartbeat is refreshed concurrently with a reap attempt SHALL NOT be reaped if the refresh commits
first.

#### Scenario: Two instances reap concurrently
- **WHEN** two reaper passes run at the same moment over the same stale run
- **THEN** exactly one of them reports it reaped, and exactly one WARN and one terminal event are produced

### Requirement: First terminal write wins

A run's terminal outcome SHALL be written only while the run is still non-terminal. If a reaped run's execution
later finishes, its outcome SHALL NOT overwrite the `failed` row, the pipeline's last-run fields, node snapshots,
history, alert state, or the rows of any dataset the pipeline writes back to. That late outcome SHALL be logged at WARN.

#### Scenario: Stalled instance finishes after its run was reaped
- **WHEN** a run is reaped and its execution then succeeds
- **THEN** the run stays `failed`, and no snapshot, history or write-back dataset row is written by that execution
