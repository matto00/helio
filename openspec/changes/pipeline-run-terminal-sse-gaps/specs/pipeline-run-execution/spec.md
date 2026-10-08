## MODIFIED Requirements

### Requirement: Non-dry run persists a pipeline_runs record
For a non-dry run (`dry` query parameter absent or not `"true"`), the backend SHALL insert a row
into `pipeline_runs` with `status = "queued"` before execution begins. After execution completes
the backend SHALL update that row to the terminal status (`"succeeded"` or `"failed"`), setting
`completed_at`, `row_count` (on success), and `error_log` (on failure). A run blocked by an
error-severity assertion failure (see `pipeline-assert-fail-policy`) SHALL also reach terminal status
`"failed"`, with `row_count` unset (`null`) and `error_log` set to a descriptive summary naming the
failing rule(s) — distinct from the generic message used for an unrelated execution exception. The
backend SHALL then delete all but the 10 most recent `pipeline_runs` rows for the pipeline. These
side-effects SHALL be skipped when `pipelineRunRepo` is unavailable (null-safe guard).

In addition, at each status transition the backend SHALL publish a `RunStatusEvent` to
`PipelineRunRegistry` for the pipeline: `queued` once the run is admitted by the pipeline-run guard (see
`pipeline-run-guard`), `running` when the engine starts, and `succeeded` or `failed` on completion (a blocked run
publishes `failed`). A submit rejected by the guard publishes no event. A run whose deferred `upsertsource`
write-back fails, whether reported as a failure or raised as an exception, SHALL reach terminal status `"failed"`
with a descriptive `error_log` and publish exactly one `failed` event.

#### Scenario: Successful non-dry run creates a succeeded pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run` is called without `?dry=true` and execution succeeds
- **THEN** a `pipeline_runs` row exists with `status = "succeeded"`, `row_count` equal to the
  result row count, and `completed_at` set

#### Scenario: Failed non-dry run creates a failed pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run` is called without `?dry=true` and execution fails
- **THEN** a `pipeline_runs` row exists with `status = "failed"` and `error_log` containing
  the error message

#### Scenario: Dry run creates a pipeline_runs record with status dry_run
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called and execution succeeds
- **THEN** a `pipeline_runs` row is inserted with `status = "dry_run"`, `completed_at` set to the
  run start time, `row_count` equal to the result row count, and `error_log` null

#### Scenario: Failed dry run does not create a pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called and execution fails
- **THEN** no `pipeline_runs` row is inserted (the route returns 422 immediately without recording)

#### Scenario: SSE queued event published before engine starts
- **WHEN** `POST /api/pipelines/:id/run` is received and the run is admitted by the pipeline-run guard
- **THEN** a `queued` RunStatusEvent is published to PipelineRunRegistry before the engine is invoked

#### Scenario: Guard-rejected submit publishes no SSE event
- **WHEN** `POST /api/pipelines/:id/run` is rejected with `429` by the pipeline-run rate limit or concurrency cap
- **THEN** no RunStatusEvent is published to PipelineRunRegistry for that submit

#### Scenario: Write-back exception persists a failed pipeline_runs record
- **WHEN** a non-dry run's execution succeeds but applying its deferred `upsertsource` write-back raises an exception
- **THEN** a `pipeline_runs` row exists with `status = "failed"` and an `error_log` naming `upsertsource`, and
  exactly one `failed` RunStatusEvent is published after that row is durable

#### Scenario: SSE running event published when engine starts
- **WHEN** the in-process engine is about to be invoked for a run
- **THEN** a `running` RunStatusEvent is published to PipelineRunRegistry

#### Scenario: SSE succeeded event published on successful completion
- **WHEN** execution succeeds with N result rows and the run is not blocked by an assertion failure
- **THEN** a `succeeded` RunStatusEvent with `rowCount = N` is published to PipelineRunRegistry

#### Scenario: SSE failed event published on execution failure
- **WHEN** execution fails with an exception
- **THEN** a `failed` RunStatusEvent with the error message in `errorLog` is published to PipelineRunRegistry

#### Scenario: Blocked run persists a failed pipeline_runs record with a descriptive errorLog
- **WHEN** a non-dry run's `assert` step has an error-severity rule that fails
- **THEN** a `pipeline_runs` row exists with `status = "failed"`, `row_count` null, and `error_log`
  naming the failing rule's kind and field — not the generic execution-exception message

