# outputs-model Specification

## Purpose
Outputs are the panel-ready visualization attached to a pipeline node; this capability
owns their persistence, kinds, and sharing-aware authorization.

## Requirements

### Requirement: Outputs table persists pipeline-node visualizations
The system SHALL persist an `outputs` row with `id, pipeline_id (FK CASCADE),
node_step_id (FK CASCADE, NULL = pipeline root), owner_id, name, kind, config JSONB,
schema JSONB, position, tag, created_at, updated_at`.

#### Scenario: Output created at the pipeline root
- **WHEN** an Output is created with `node_step_id = NULL`
- **THEN** it is attached to the pipeline's root frame rather than any step

### Requirement: Output kind is one of the Phase-1 set
The system SHALL restrict `outputs.kind` to `metric | chart | table | collection |
timeline | markdown`.

#### Scenario: Unknown kind rejected
- **WHEN** an Output is created or updated with a kind outside the Phase-1 set
- **THEN** the write is rejected

### Requirement: Outputs inherit the owning pipeline's sharing-aware ACL
The system SHALL authorize read/write access to an Output using the same
sharing-aware access check used for its pipeline (owner + grantees), not the
owner-only policy used for pipeline steps.

#### Scenario: A pipeline grantee can read its Outputs
- **WHEN** a user who has been granted access to a pipeline (but does not own it)
  reads an Output attached to that pipeline
- **THEN** the read succeeds

#### Scenario: A non-owner, non-grantee is denied
- **WHEN** a user with no ownership or grant on the pipeline attempts to read or
  write one of its Outputs
- **THEN** the request is denied

### Requirement: An Output inherits its pipeline's tag for teardown purposes
For `teardown_resources`/tag-cascade purposes, an Output SHALL be treated as inheriting its
owning pipeline's tag, with no independent tag of its own required for cascade deletion to reach
it.

#### Scenario: An Output with no tag of its own is still removed by its pipeline's tag teardown
- **WHEN** a pipeline tagged `demo` with an Output that has no explicit tag is torn down via
  `teardown_resources(tag="demo")`
- **THEN** the Output (and its placements) is removed as part of that teardown

### Requirement: Migration V117 repairs V94/HEL-877 dead Output config keys

Migration V117 SHALL remove from every `outputs.config` `metricLabel`, `metricUnit`, `chartAnnotation`, `columnWidths`,
`tableDensity`, `collectionOptions`, `timelineOptions`, `legend`, `tooltip`, `seriesColors` and `axisLabels`. It SHALL
also remove `format`, `columnOrder` and `chartOptions` from any Output whose kind does not accept that key. A dead key with a
live equivalent SHALL be renamed to that live key only when the kind accepts it, the dead value (or its nested `layout`/
`sort`) is non-null and has the shape the live key's reader accepts (a string for `label`/`unit`/`annotation`;
`"grid"`/`"list"`; `"asc"`/`"desc"`), and the live key is absent or JSON null. Otherwise the dead key SHALL be dropped. A
non-null live key SHALL never be overwritten. Every key the migration changes SHALL be recorded, with its prior value,
in `hel1387_dropped_output_config_keys`.

#### Scenario: Dead metric label is renamed
- **WHEN** a metric Output's config holds `"metricLabel": "Revenue"` and no `label`
- **THEN** after V117 its config holds `"label": "Revenue"` and no `metricLabel`

#### Scenario: Null live key is filled
- **WHEN** a chart Output's config holds `"annotation": null` and `"chartAnnotation": "Q3 dip"`
- **THEN** after V117 its config holds `"annotation": "Q3 dip"` and no `chartAnnotation`

#### Scenario: Non-null live key is never overwritten
- **WHEN** a collection Output holds `"layout": "grid"` and `"collectionOptions": {"layout": "list"}`
- **THEN** after V117 `layout` is still `"grid"`, `collectionOptions` is gone, and the audit table records it

#### Scenario: Wrongly-shaped dead value is dropped, not renamed
- **WHEN** a collection Output holds `"collectionOptions": {"layout": "tile"}` and no `layout`
- **THEN** after V117 it has no `layout` and no `collectionOptions`, and the audit table records `invalid-value`

#### Scenario: Re-running changes nothing
- **WHEN** the V117 statements run a second time on already-migrated data
- **THEN** no Output config and no audit row changes
