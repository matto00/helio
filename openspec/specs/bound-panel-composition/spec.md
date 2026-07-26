# bound-panel-composition Specification

## Purpose
Let a caller compose a single bound panel — data source, pipeline (with steps), a synchronous
run, and a panel bind — in one atomic-feeling `POST /api/panels/bound` call, with an up-front
validation gate and named-stage compensating cleanup, instead of chaining six separate requests.

## Requirements
### Requirement: POST /api/panels/bound composes source, pipeline, run, and panel bind in one call

The system SHALL expose `POST /api/panels/bound`, accepting `{ dashboardId, source?,
sourceDataSourceId?, pipeline: { name?, outputDataTypeName, steps }, panel: { type, title, config?,
appearance? }, fieldMapping? }`. Exactly one of `source` (inline `{name, columns, rows}`) or
`sourceDataSourceId` (an existing, caller-owned DataSource) SHALL be present; a request with both
or neither SHALL be rejected with 400 before any read or write. On success the system SHALL
create (or reuse) the DataSource, create the Pipeline and its steps, run the pipeline
synchronously, create the panel, and bind it to the pipeline's output DataType — returning `201`
with `{ sourceId, pipelineId, dataTypeId, panel }`, rows already present.

#### Scenario: Inline source, happy path
- **WHEN** an authenticated user POSTs `/api/panels/bound` with an inline `source` (columns+rows),
  a single-step `pipeline`, and a `panel` of type `metric` with a satisfiable `fieldMapping`
- **THEN** the response is `201` with a real `sourceId`, `pipelineId`, `dataTypeId`, and a `panel`
  whose `config.dataTypeId` equals the returned `dataTypeId`, and `GET /api/types/:dataTypeId/rows`
  returns the pipeline's output rows immediately (no separate run call needed)

#### Scenario: Reuse an existing DataSource
- **WHEN** the request supplies `sourceDataSourceId` for a DataSource the caller already owns,
  omitting `source`
- **THEN** no new DataSource is created, the returned `sourceId` equals the supplied
  `sourceDataSourceId`, and the pipeline is built over that existing source

#### Scenario: A zero-row pipeline run is not a failure
- **WHEN** the pipeline's steps (e.g. a `filter`) legitimately reduce the source to zero output
  rows
- **THEN** the call still returns `201` with a bound, empty panel — not an error

### Requirement: Panel/DataType binding is validated before any resource is created

Given the requested panel `type` and `fieldMapping`, the system SHALL compute the pipeline's
projected output schema from the source schema and the requested `pipeline.steps` (without
creating the DataSource, Pipeline, or Panel) and SHALL reject the request with `400` when no
column satisfies a required binding slot for that panel type — before any write occurs. `panel.type`
values outside the data-bindable panel kinds (metric/chart/table/timeline/collection) SHALL be
rejected with `400` before any write.

#### Scenario: Unsatisfiable chart binding rejected up front
- **WHEN** a request's `pipeline.steps` project an output schema with no numeric column, and
  `panel.type` is `chart` (whose `yAxis` slot requires a numeric column)
- **THEN** the response is `400` naming the unsatisfied slot, and no DataSource, Pipeline, or Panel
  exists afterward — confirmed by the caller's own resource listings being unchanged

#### Scenario: Unsupported panel type rejected up front
- **WHEN** `panel.type` is `markdown` (not a data-bindable kind)
- **THEN** the response is `400` directing the caller to `POST /api/panels` for non-bindable panel
  types, and no resource is created

### Requirement: A mid-chain failure names its stage and triggers compensating cleanup

The system SHALL, once the validation gate has passed, respond to a failure while creating the
pipeline, adding a step, running the pipeline, or creating the panel with a `4xx`/`5xx` response
naming the failed stage (`"source"|"pipeline"|"steps"|"run"|"panel"`) and SHALL trigger
best-effort cleanup of every resource this call created so far: any `data_type_rows` written for
the pipeline's output type, the
output DataType (which cascades the Pipeline and its steps), and — only when `source` was created
inline by this same call — that DataSource's companion DataType and the DataSource itself. A
reused `sourceDataSourceId` is never modified or deleted by cleanup. No panel is ever left bound to
a nonexistent or deleted DataType.

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

### Requirement: Every resource in the chain is owner-scoped

The system SHALL create every resource (DataSource, Pipeline, steps, output DataType, Panel) under
the calling user's ownership, and a `sourceDataSourceId` referencing another user's DataSource
SHALL be rejected as `404 Not Found` (never `403`, no existence leak) before any write.

#### Scenario: Cross-tenant sourceDataSourceId reuse is rejected without leaking existence
- **WHEN** a request supplies a `sourceDataSourceId` that belongs to a different user
- **THEN** the response is `404 Not Found`, indistinguishable from supplying an id that does not
  exist at all, and no resource is created

