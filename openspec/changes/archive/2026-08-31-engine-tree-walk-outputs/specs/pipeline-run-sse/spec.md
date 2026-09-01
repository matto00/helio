## MODIFIED Requirements

### Requirement: PipelineRunRegistry publishes status events at each run transition
The backend SHALL maintain an in-memory registry (`PipelineRunRegistry`) keyed by pipeline ID.
`PipelineRunRoutes` SHALL publish events to the registry at each status transition:
`queued` before execution starts, `running` after the engine begins, one or more `node-progress`
events as the tree-walk engine completes each node (trunk and tails alike), and `succeeded` or
`failed` on completion, `dry_run` on successful dry-run completion. A non-dry run whose execution
completes without exception but is blocked by an error-severity assertion failure (see
`pipeline-assert-fail-policy`) SHALL publish `failed`, not `succeeded`, with `errorLog` naming the
failing rule(s) — this is a terminal-status outcome distinct from an execution exception, but uses the
same `failed` event kind. `node-progress` is NOT a terminal status — the stream SHALL remain open
across it. Events SHALL be ephemeral — not persisted to the database.

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

#### Scenario: node-progress event does not close the stream
- **WHEN** a `node-progress` event is published for a pipeline run
- **THEN** the SSE stream remains open and continues to accept further events

## ADDED Requirements

### Requirement: Run-status events carry per-node identity and row counts

Each `node-progress` SSE event emitted while a pipeline runs SHALL include a `nodeId` field
identifying which step-tree node the event describes (or its absence for the pipeline root), and a
`rowCount` field for that node's frame at the point the event was emitted. This applies to trunk nodes
and tail nodes alike.

#### Scenario: A tail node's progress is reported by node id

- **GIVEN** a pipeline with a tail attached to a mid-trunk node
- **WHEN** the pipeline runs and the tail is evaluated
- **THEN** a `node-progress` SSE event is emitted carrying the tail node's `nodeId` and its row count

### Requirement: Assertion results are keyed by node

`pipeline_run_assertions` rows SHALL be keyed by the step-tree node they were evaluated against
(via the existing `step_id` column), covering trunk and tail nodes alike.

#### Scenario: An assertion on a tail step is recorded against that tail's node

- **GIVEN** an assert step attached to a tail
- **WHEN** the pipeline runs and the assertion evaluates
- **THEN** the resulting `pipeline_run_assertions` row's `step_id` identifies the tail's own step,
  not the trunk node it branched from
