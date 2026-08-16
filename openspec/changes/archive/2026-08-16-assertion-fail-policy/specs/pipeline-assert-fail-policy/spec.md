## ADDED Requirements

### Requirement: An error-severity assertion failure blocks the DataType update
The system SHALL skip the output DataType's schema upsert, row overwrite, and binary-ref overwrite for a
real (non-dry) run when at least one evaluated assertion result has `severity = "error"` and
`passed = false`. The DataType's previously-persisted schema and rows SHALL remain exactly as they were
before the run.

#### Scenario: A failing error-severity assertion preserves the prior DataType snapshot
- **WHEN** a pipeline run evaluates an `assert` step whose `notNull` rule (severity `error`) fails
- **THEN** the output DataType's rows and schema are unchanged from before the run

#### Scenario: A failing warn-severity assertion does not block the update
- **WHEN** a pipeline run evaluates an `assert` step whose only failing rule has severity `warn`
- **THEN** the output DataType's schema and rows are updated normally, exactly as if the rule had passed

### Requirement: Alert-rule evaluation is skipped for a blocked run
The system SHALL NOT evaluate alert rules against a run's computed rows when that run is blocked by an
error-severity assertion failure, since those rows are never written to the DataType.

#### Scenario: Alert evaluation does not fire for a blocked run
- **WHEN** a pipeline run is blocked by a failing error-severity assertion
- **THEN** no alert-rule evaluation is performed against that run's computed rows

### Requirement: A blocked run's terminal status and error summary make the block discoverable
A blocked run SHALL be marked with terminal status `"failed"` (reusing the existing status — no new
`pipeline_runs.status` value is introduced), with an `errorLog` that names the failing rule(s) — kind,
field, and the rule's own evaluation message — distinct from the generic message used for an unrelated
execution exception.

#### Scenario: Blocked run's errorLog names the failing rule
- **WHEN** a run is blocked by a `notNull` rule failing on field `email`
- **THEN** the run's persisted `errorLog` identifies the rule kind and field, not a generic
  "Pipeline execution failed" placeholder

#### Scenario: Blocked run's assertion results are still persisted
- **WHEN** a run is blocked by one error-severity rule while other rules (passing or warn-severity) were
  also evaluated
- **THEN** every evaluated `AssertionResult` — not only the blocking one — is persisted in
  `pipeline_run_assertions`, unchanged from 419-B's existing unconditional persistence behavior

### Requirement: Dry runs are exempt from the fail policy
A dry run SHALL NOT be blocked by an error-severity assertion failure, since a dry run never writes
DataType schema or rows in the first place; its terminal status remains `"dry_run"` regardless of
assertion outcome.

#### Scenario: A dry run with a failing error-severity assertion still completes as a dry run
- **WHEN** a dry-run pipeline evaluates an `assert` step whose rule fails with severity `error`
- **THEN** the dry run still completes with status `"dry_run"`, and its assertion results are persisted
  exactly as 419-B already does
