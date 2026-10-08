## MODIFIED Requirements

### Requirement: PipelineRunRegistry publishes status events at each run transition
The backend SHALL maintain an in-memory registry (`PipelineRunRegistry`) keyed by pipeline ID.
`PipelineRunRoutes` SHALL publish events to the registry at each status transition:
`queued` once the run has been admitted by the pipeline-run guard (the rate limit, and for a non-dry run the
concurrency cap) and before execution starts, `running` after the engine begins, one or more `node-progress`
events as the tree-walk engine completes each node (trunk and tails alike), and `succeeded` or
`failed` on completion, `dry_run` on successful dry-run completion. A submit rejected by the pipeline-run guard (a
`429`), or whose guard check itself fails, SHALL publish no event at all. A non-dry run whose execution
completes without exception but is blocked by an error-severity assertion failure (see
`pipeline-assert-fail-policy`) SHALL publish `failed`, not `succeeded`, with `errorLog` naming the
failing rule(s) — this is a terminal-status outcome distinct from an execution exception, but uses the
same `failed` event kind. A non-dry run whose deferred `upsertsource` write-back fails — whether reported as a failure
or raised as an exception — SHALL publish exactly one `failed` event. A terminal event (`succeeded`, `failed`,
`dry_run`) SHALL be published only after
that run's terminal writes have completed, so that any subscriber reacting to it reads the run's terminal status
from `GET /api/pipelines/:id/runs/latest` and, for `succeeded`, the run's materialized Output rows. Exactly one
terminal event SHALL still be published per run when a terminal write fails. `node-progress` is NOT a terminal status — the stream SHALL remain open
across it. Events SHALL be ephemeral — not persisted to the database.

#### Scenario: Queued event published before engine starts
- **WHEN** `POST /api/pipelines/:id/run` is received and the run is admitted by the pipeline-run guard
- **THEN** a `queued` event is published to the registry for that pipeline ID before the engine starts

#### Scenario: Guard-rejected submit publishes no event
- **WHEN** a submit is rejected with `429` by the pipeline-run rate limit or concurrency cap
- **THEN** no event is published to the registry for that submit, and an open subscriber's stream stays open to
  receive any other run's events

#### Scenario: Running event published when engine starts
- **WHEN** the in-process engine begins executing steps
- **THEN** a `running` event is published to the registry for that pipeline ID

#### Scenario: Succeeded event carries row count
- **WHEN** a non-dry run completes successfully with N result rows and is not blocked by an
  error-severity assertion failure
- **THEN** a `succeeded` event is published with `rowCount: N`

#### Scenario: Failed event carries error message
- **WHEN** a run fails with an exception message
- **THEN** a `failed` event is published with `errorLog` containing the error message

#### Scenario: Write-back exception publishes exactly one failed event
- **WHEN** a non-dry run's engine execution succeeds but applying its deferred `upsertsource` write-back raises an
  exception
- **THEN** the run's record is persisted as `failed`, and then exactly one `failed` event is published whose
  `errorLog` names `upsertsource` without exposing the raw exception

#### Scenario: Dry-run emits dry_run terminal event
- **WHEN** `POST /api/pipelines/:id/run?dry=true` completes successfully
- **THEN** a `dry_run` event is published with `rowCount` equal to the result row count

#### Scenario: Run blocked by an error-severity assertion publishes failed, not succeeded
- **WHEN** a non-dry run completes execution without exception, but an `assert` step's error-severity
  rule fails
- **THEN** a `failed` event is published (not `succeeded`), with `errorLog` naming the failing rule

#### Scenario: node-progress event does not close the stream
- **WHEN** a `node-progress` event is published for a pipeline run
- **THEN** the SSE stream remains open and continues to accept further events

#### Scenario: Succeeded event is published only after the run's results are durable
- **WHEN** a subscriber receives a `succeeded` event for a run that has a persisted run record and immediately reads that pipeline's latest run and
  the run's materialized Output rows
- **THEN** the latest run is that run with status `succeeded`, and the Output rows are the ones that run produced

#### Scenario: Failed and dry_run events are published only after the terminal status is durable
- **WHEN** a subscriber receives a `failed` or `dry_run` event for a run that has a persisted run record and
  immediately reads that pipeline's run record for that run
- **THEN** the record already carries that terminal status
