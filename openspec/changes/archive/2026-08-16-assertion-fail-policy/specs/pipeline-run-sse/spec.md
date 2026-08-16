## MODIFIED Requirements

### Requirement: PipelineRunRegistry publishes status events at each run transition
The backend SHALL maintain an in-memory registry (`PipelineRunRegistry`) keyed by pipeline ID.
`PipelineRunRoutes` SHALL publish events to the registry at each status transition:
`queued` before execution starts, `running` after the engine begins, `succeeded` or `failed` on
completion, `dry_run` on successful dry-run completion. A non-dry run whose execution completes without
exception but is blocked by an error-severity assertion failure (see `pipeline-assert-fail-policy`)
SHALL publish `failed`, not `succeeded`, with `errorLog` naming the failing rule(s) — this is a
terminal-status outcome distinct from an execution exception, but uses the same `failed` event kind.
Events SHALL be ephemeral — not persisted to the database.

#### Scenario: Queued event published before engine starts
- **WHEN** `POST /api/pipelines/:id/run` is received and pre-execution DB work begins
- **THEN** a `queued` event is published to the registry for that pipeline ID

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

#### Scenario: Dry-run emits dry_run terminal event
- **WHEN** `POST /api/pipelines/:id/run?dry=true` completes successfully
- **THEN** a `dry_run` event is published with `rowCount` equal to the result row count

#### Scenario: Run blocked by an error-severity assertion publishes failed, not succeeded
- **WHEN** a non-dry run completes execution without exception, but an `assert` step's error-severity
  rule fails
- **THEN** a `failed` event is published (not `succeeded`), with `errorLog` naming the failing rule
