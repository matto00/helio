## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/run executes steps and returns a result
The backend SHALL expose `POST /api/pipelines/:id/run` that fetches the pipeline's steps ordered
ascending by `position`, applies each step in sequence to an in-memory row set loaded from the
pipeline's source DataSource, and returns the result. For non-dry runs the response SHALL be
`200 OK` with `{ rows: [...], rowCount: N }` regardless of whether the run is subsequently blocked by
an error-severity assertion failure (see `pipeline-assert-fail-policy`) — step execution itself
completed without exception, so the HTTP response contract is unaffected by the fail-policy decision.
`pipelines.last_run_status` SHALL be set to `"succeeded"` and `pipelines.last_run_at` SHALL be set to
the current timestamp on success, UNLESS the run is blocked by an error-severity assertion failure, in
which case `last_run_status` SHALL be set to `"failed"` instead, exactly as it would be for a step
execution failure. On step execution failure the response SHALL be `422 Unprocessable Entity` with an
error message, and `last_run_status` SHALL be set to `"failed"`.

When the failure originates inside a step of a run executed by the in-process pipeline engine, the error
message SHALL begin with the literal prefix
`Pipeline execution failed` and SHALL additionally name the failing step's id, the step's kind, and a
reason. The reason SHALL be the message of the underlying exception when and only when that exception is
an `IllegalArgumentException` — the type used by every step's own hand-written configuration validation.
For any other throwable the reason SHALL be a fixed, non-descriptive string; the step id and kind SHALL
still be reported. The client-facing message SHALL NOT contain a stack trace, a package-qualified class
name, or any other internal detail. The full throwable SHALL continue to be logged server-side.

This message is used identically on all three client-visible surfaces it already reaches: the SSE
`errorLog` event, `RunStatusResponse.error`, and the persisted `PipelineRunRecord.errorLog`. Step preview
(`previewStep`) SHALL report failures the same way.

#### Scenario: Run with no steps returns source rows unchanged
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline that has no steps
- **THEN** the response is `200 OK` with all source rows returned and `last_run_status` is `"succeeded"`

#### Scenario: Run with multiple steps applies them in position order
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline with steps at positions 0, 1, 2
- **THEN** the response is `200 OK` with rows that reflect the cumulative output of all three steps applied in order

#### Scenario: Run with an invalid step expression returns 422
- **WHEN** a filter step contains an invalid expression and `POST /api/pipelines/:id/run` is called
- **THEN** the response is `422 Unprocessable Entity` and `last_run_status` is `"failed"`

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `POST /api/pipelines/:id/run` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Run blocked by an error-severity assertion still returns 200 OK, but last_run_status is failed
- **WHEN** `POST /api/pipelines/:id/run` is called and step execution completes without exception, but an
  `assert` step's error-severity rule fails
- **THEN** the HTTP response is still `200 OK` with the computed rows, but `pipelines.last_run_status` is
  set to `"failed"`, not `"succeeded"`

#### Scenario: Step failure names the step id, kind, and reason
- **GIVEN** a pipeline whose second step is a `stringops` step configured with an unsupported `operation`
- **WHEN** `POST /api/pipelines/:id/run` is called
- **THEN** the response is `422 Unprocessable Entity`
- **AND** the error message contains that step's id, the string `stringops`, and the underlying
  validation message naming the unsupported value and the supported operations

#### Scenario: A non-validation failure does not leak internals
- **GIVEN** a step that fails with a throwable that is not an `IllegalArgumentException`
- **WHEN** the pipeline is run
- **THEN** the error message names the failing step's id and kind
- **AND** the message contains neither the throwable's message nor any package-qualified class name
