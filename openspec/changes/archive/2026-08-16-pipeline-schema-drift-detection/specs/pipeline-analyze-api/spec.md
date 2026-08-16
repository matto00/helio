# pipeline-analyze-api Delta

## ADDED Requirements

### Requirement: Analyze response surfaces source-schema drift

The `GET /api/pipelines/:id/analyze` response SHALL include an optional `sourceSchemaDrift` object computed at
analyze time by diffing the current source schema against the pipeline's persisted `last_source_schema`
baseline. The field SHALL be absent when there is no baseline (no successful run yet) or no drift. When
present, it SHALL contain `addedColumns` and `removedColumns` (arrays of `{name, type}`) and
`typeChangedColumns` (array of `{name, previousType, currentType}`). The field SHALL be additive and optional
in `schemas/pipeline-analyze-response.schema.json` (not in `required`) so existing consumers are unaffected. A
malformed persisted baseline SHALL be treated as no baseline (no drift reported, no error).

#### Scenario: No baseline yields absent field
- **WHEN** `GET /api/pipelines/:id/analyze` is called for a pipeline that has never run successfully
- **THEN** the 200 response contains no `sourceSchemaDrift` member

#### Scenario: Drift since last successful run is reported
- **WHEN** a pipeline last ran successfully with source schema `[{a, string}, {b, number}]` and the source's
  current schema is `[{a, string}]`
- **THEN** the analyze response includes `sourceSchemaDrift.removedColumns: [{name: "b", type: "number"}]`

#### Scenario: Unchanged schema yields absent field
- **WHEN** a pipeline's current source schema equals its persisted baseline
- **THEN** the 200 response contains no `sourceSchemaDrift` member
