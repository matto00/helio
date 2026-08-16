## MODIFIED Requirements

### Requirement: A mid-chain failure names its stage and triggers compensating cleanup
The system SHALL, once the validation gate has passed, respond to a failure — or a run blocked by an
error-severity assertion failure (see `pipeline-assert-fail-policy`), treated identically to a run
failure for this purpose — while creating the pipeline, adding a step, running the pipeline, or
creating the panel with a `4xx`/`5xx` response naming the failed stage
(`"source"|"pipeline"|"steps"|"run"|"panel"`) and SHALL trigger best-effort cleanup of every resource
this call created so far: any `data_type_rows` written for the pipeline's output type, the output
DataType (which cascades the Pipeline and its steps), and — only when `source` was created inline by
this same call — that DataSource's companion DataType and the DataSource itself. A reused
`sourceDataSourceId` is never modified or deleted by cleanup. No panel is ever left bound to a
nonexistent or deleted DataType, and no panel is ever left bound to a DataType whose pipeline run was
blocked by a failing assertion.

#### Scenario: Run failure cleans up the created pipeline and source
- **WHEN** the inline-source and pipeline/steps stages succeed but the pipeline run itself fails
  (e.g. an unsupported source type reaches the engine)
- **THEN** the response is `4xx`/`5xx` naming stage `"run"`, and afterward `GET /api/pipelines` and
  `GET /api/data-sources` for the caller show neither the pipeline nor the inline source that this
  call attempted to create

#### Scenario: Panel-creation failure after a successful run still cleans up
- **WHEN** the source, pipeline, steps, and run all succeed but panel creation fails (e.g. the
  target dashboard is deleted concurrently)
- **THEN** the response is `4xx`/`5xx` naming stage `"panel"`, and the pipeline's output DataType
  (and its rows) created by this call no longer exist afterward

#### Scenario: A run blocked by an error-severity assertion is treated as a run-stage failure
- **WHEN** the inline-source and pipeline/steps stages succeed, and the pipeline run itself completes
  execution without exception but is blocked by an `assert` step's error-severity rule failing
- **THEN** the response is `4xx`/`5xx` naming stage `"run"` (not a `201 Created` bound panel), and
  afterward `GET /api/pipelines` and `GET /api/data-sources` for the caller show neither the pipeline
  nor the inline source that this call attempted to create — no panel is ever bound to the
  never-populated output DataType
