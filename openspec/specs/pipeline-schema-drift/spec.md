# pipeline-schema-drift Specification

## Purpose
Capture a source-schema baseline on each successful pipeline run and report drift (added / removed /
type-changed columns) against it at analyze time, so source changes stop silently reshaping pipeline output.
## Requirements
### Requirement: Successful runs persist a source-schema baseline

On each successful (non-dry) pipeline run, the system SHALL persist the pipeline's current source schema — the
same `[{name, type}]` derivation the analyze path uses (source DataType declared fields) — to
`pipelines.last_source_schema` (nullable JSONB), alongside the existing last-run metadata update. Baseline
persistence SHALL be best-effort: a persistence failure SHALL NOT fail or block the run. Dry runs SHALL NOT
update the baseline. Failed runs SHALL NOT update the baseline.

#### Scenario: Baseline written on successful run
- **WHEN** a pipeline run completes successfully for a source whose schema is `[{name: "a", type: "string"}]`
- **THEN** `pipelines.last_source_schema` for that pipeline contains `[{"name": "a", "type": "string"}]`

#### Scenario: Dry run leaves baseline untouched
- **WHEN** a dry run completes successfully for a pipeline with an existing baseline
- **THEN** `pipelines.last_source_schema` is unchanged

### Requirement: Drift diff reports added, removed, and type-changed columns

A pure diff over (baseline, current) source schemas SHALL return no drift when the baseline is absent (never a
successful run) or when the schemas are equivalent (order-insensitive by column name), and otherwise SHALL
return a structured result with `addedColumns` (in current only), `removedColumns` (in baseline only), and
`typeChangedColumns` (shared name, differing type — reporting `name`, `previousType`, `currentType`).

#### Scenario: No baseline yields no drift
- **WHEN** the diff runs with no baseline (first run has not happened)
- **THEN** no drift is reported

#### Scenario: Removed column reported
- **WHEN** the baseline is `[{a, string}, {b, number}]` and the current schema is `[{a, string}]`
- **THEN** drift reports `removedColumns: [{b, number}]` and empty `addedColumns`/`typeChangedColumns`

#### Scenario: Type change reported
- **WHEN** the baseline is `[{a, string}]` and the current schema is `[{a, number}]`
- **THEN** drift reports `typeChangedColumns: [{name: a, previousType: string, currentType: number}]`

#### Scenario: Identical schemas yield no drift
- **WHEN** the baseline and current schema contain the same columns and types (in any order)
- **THEN** no drift is reported

