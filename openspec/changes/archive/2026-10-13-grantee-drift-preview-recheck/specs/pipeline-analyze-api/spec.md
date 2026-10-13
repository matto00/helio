## MODIFIED Requirements

### Requirement: Analyze response surfaces source-schema drift

The `GET /api/pipelines/:id/analyze` response SHALL include an optional `sourceSchemaDrift` object computed at
analyze time by diffing the current source schema against the pipeline's persisted `last_source_schema`
baseline. The field SHALL be absent when there is no baseline (no successful run yet) or no drift. When
present, it SHALL contain `addedColumns` and `removedColumns` (arrays of `{name, type}`) and
`typeChangedColumns` (array of `{name, previousType, currentType}`). The field SHALL be additive and optional
in `schemas/pipelines/pipeline-analyze-response.schema.json` (not in `required`) so existing consumers are unaffected. A
malformed persisted baseline SHALL be treated as no baseline (no drift reported, no error).

Drift SHALL be computed as the pipeline's OWNER sees it, whoever calls analyze: both the baseline and the current
primary-root source schema it is diffed against SHALL be read in the owner's view, so a grantee (viewer or editor)
with access to the pipeline receives exactly the `sourceSchemaDrift` the owner's analyze returns at the same moment.
This SHALL NOT change any other part of the response, which stays in the caller's own view.

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

#### Scenario: A grantee sees the owner's drift
- **WHEN** a pipeline whose primary root is a source owned by the pipeline's owner last ran successfully with schema
  `[{a, string}, {b, number}]`, that source's schema is now `[{a, string}]`, and an editor or viewer grantee who does
  not own the source calls analyze
- **THEN** the grantee's response includes `sourceSchemaDrift.removedColumns: [{name: "b", type: "number"}]`, equal
  to the owner's analyze response's `sourceSchemaDrift`

#### Scenario: A grantee sees no spurious drift for a source only the owner can see
- **WHEN** a grantee calls analyze on a pipeline whose baseline equals the owner-visible source's current schema
- **THEN** the grantee's response contains no `sourceSchemaDrift` member
