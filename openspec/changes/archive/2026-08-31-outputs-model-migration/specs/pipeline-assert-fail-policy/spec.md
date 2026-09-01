## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: An error-severity assertion failure blocks the DataType update
The system SHALL skip the materialized node's schema upsert, row overwrite, and binary-ref overwrite for a
real (non-dry) run when at least one evaluated assertion result has `severity = "error"` and
`passed = false`. The Output's previously-persisted schema and rows SHALL remain exactly as they were
before the run.

#### Scenario: A failing error-severity assertion preserves the prior DataType snapshot
- **WHEN** a pipeline run evaluates an `assert` step whose `notNull` rule (severity `error`) fails
- **THEN** the Output's rows and schema are unchanged from before the run

#### Scenario: A failing warn-severity assertion does not block the update
- **WHEN** a pipeline run evaluates an `assert` step whose only failing rule has severity `warn`
- **THEN** the materialized node's schema and rows are updated normally, exactly as if the rule had passed

### Requirement: Alert-rule evaluation is skipped for a blocked run
The system SHALL NOT evaluate alert rules against a run's computed rows when that run is blocked by an
error-severity assertion failure, since those rows are never written to the Output.

#### Scenario: Alert evaluation does not fire for a blocked run
- **WHEN** a pipeline run is blocked by a failing error-severity assertion
- **THEN** no alert-rule evaluation is performed against that run's computed rows

### Requirement: Dry runs are exempt from the fail policy
A dry run SHALL NOT be blocked by an error-severity assertion failure, since a dry run never writes
Output schema or rows in the first place; its terminal status remains `"dry_run"` regardless of
assertion outcome.

#### Scenario: A dry run with a failing error-severity assertion still completes as a dry run
- **WHEN** a dry-run pipeline evaluates an `assert` step whose rule fails with severity `error`
- **THEN** the dry run still completes with status `"dry_run"`, and its assertion results are persisted
  exactly as 419-B already does
