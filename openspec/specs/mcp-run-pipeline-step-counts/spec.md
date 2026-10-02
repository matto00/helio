# mcp-run-pipeline-step-counts Specification

## Purpose
Specifies per-step row counts, runId and zero-row warnings in the MCP run_pipeline result.

## Requirements

### Requirement: run_pipeline reports per-step row counts and zero-row warnings
The MCP `run_pipeline` result SHALL include `runId`, `stepRowCounts` (step id to row count as returned by the backend) and `warnings`. A warning is emitted for a step whose own count is 0 while at least one input count is greater than 0. Inputs: the step's parent (or, if the parent has no count entry because it is disabled, its nearest counted ancestor); for a root-level step of the PRIMARY root, `sourceRowCount`; for join/union/lookup, additionally the lane step named by `config.secondaryInput` when `kind` is `lane`. A step with no count entry (disabled), a root-level step of a non-primary root, an input with no count, or a malformed/unrecognised config SHALL be skipped, never warned. When `stepRowCounts` is empty (counts unavailable, e.g. Spark-executed runs), `warnings` SHALL be omitted and `stepCountsAvailable: false` SHALL be returned so absence is distinguishable from a healthy run.

#### Scenario: Join with zero matches
- **WHEN** a join step has count 0 and its parent or lane step has count > 0
- **THEN** `warnings` contains an entry naming the step id, type and input counts

#### Scenario: Healthy run
- **WHEN** no counted step has 0 rows with a non-empty input
- **THEN** `warnings` is `[]` and `stepRowCounts` is present

#### Scenario: Counts unavailable
- **WHEN** the backend returns an empty `stepRowCounts` for a run that read rows
- **THEN** the result has `stepCountsAvailable: false` and no `warnings` key

#### Scenario: Disabled parent
- **WHEN** a step's parent is disabled (no count entry)
- **THEN** the nearest counted ancestor is used and no warning is produced from the missing entry itself
