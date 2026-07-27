# workspace-context-assembly Specification

## Purpose
Provides a single server-side, owner-scoped snapshot of a caller's data sources, DataTypes, pipelines
(with per-step output columns), and dashboards via `GET /api/workspace/context`, so backend agent-grounding
paths (e.g. in-app NL authoring) don't need to fan out over individual REST endpoints or shell out to the
MCP process.
## Requirements
### Requirement: Workspace context endpoint
The system SHALL expose `GET /api/workspace/context`, mounted under the existing `WorkspaceRoutes`
`pathPrefix("workspace")`, returning a single JSON snapshot of the caller's data sources, DataTypes,
pipelines (with per-step output columns), and dashboards, structurally parallel to the MCP
`buildWorkspaceContext` `WorkspaceContext` interface (`helio-mcp/src/context.ts`), validating against
`schemas/workspace-context.schema.json`.

#### Scenario: Authenticated caller fetches workspace context
- **WHEN** an authenticated user with at least one data source, DataType, pipeline, and dashboard calls
  `GET /api/workspace/context`
- **THEN** the response is `200` with a body containing `generatedAt`, `counts`, `dataSources`, `dataTypes`,
  `pipelines`, and `dashboards`, matching `schemas/workspace-context.schema.json`

#### Scenario: Empty workspace returns empty collections, not an error
- **WHEN** an authenticated user with no data sources, DataTypes, pipelines, or dashboards calls
  `GET /api/workspace/context`
- **THEN** the response is `200` with `counts` all zero and every collection field an empty array

### Requirement: Owner-scoped assembly
Every resource collection in the workspace context SHALL be scoped to the caller exactly as the
underlying existing list method already scopes it (owner-only, `ctx.withUserContext`/`user.id`-filtered) —
the assembler SHALL NOT perform any direct database access beyond the existing
`DataSourceService`/`DataTypeRepository`/`PipelineService`/`DashboardService` methods.

#### Scenario: A caller never sees another user's resources
- **GIVEN** user A owns a data source, DataType, pipeline, and dashboard, and user B owns a distinct set
  of the same four resource kinds
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** the response's `dataSources`, `dataTypes`, `pipelines`, and `dashboards` contain only user B's
  resources, and `counts` reflects only user B's totals

### Requirement: Scoped PAT denial
A scoped Personal Access Token (`TokenScope`, HEL-369) SHALL NOT be able to read
`GET /api/workspace/context` — the request SHALL be rejected with `403 Forbidden`, inherited from
`AuthDirectives.confineScopedToken`'s existing non-`hooks`-segment denial.

#### Scenario: Scoped token is denied
- **GIVEN** a Personal Access Token scoped to a specific pipeline (`TokenScope`)
- **WHEN** that token is used to call `GET /api/workspace/context`
- **THEN** the response is `403 Forbidden`

### Requirement: DataType pipeline-output classification
Each entry in `dataTypes` SHALL set `pipelineOutput = true` if and only if the DataType's `sourceId` is
absent (a pipeline-produced, panel-bindable DataType); a DataType with a present `sourceId` (a
source-companion DataType) SHALL set `pipelineOutput = false`.

#### Scenario: Source-companion DataType is flagged non-bindable
- **GIVEN** a DataType created alongside a CSV data source (`sourceId` set)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[]` entry has `pipelineOutput: false` and `sourceId` equal to the
  owning source's id

#### Scenario: Pipeline-output DataType is flagged bindable
- **GIVEN** a DataType produced by a pipeline run (`sourceId` absent)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[]` entry has `pipelineOutput: true` and `sourceId: null`

### Requirement: Pipeline step output columns via analyze, with per-pipeline degradation
Each entry in `pipelines` SHALL include `steps`, populated by calling the existing pipeline analyze path
for that pipeline, with `outputColumns` listing each step's output schema field names. If analyze fails
for one pipeline, that pipeline's entry SHALL degrade to `steps: []` plus a `stepsError` message rather
than failing the whole `GET /api/workspace/context` request.

#### Scenario: Pipeline with steps reports output columns per step
- **GIVEN** a pipeline with two steps whose analyzed output schemas are `[a, b]` and `[a, b, c]`
- **WHEN** `GET /api/workspace/context` is called by that pipeline's owner
- **THEN** the corresponding `pipelines[].steps` entries report `outputColumns: ["a", "b"]` and
  `outputColumns: ["a", "b", "c"]` respectively, in step order

#### Scenario: One pipeline's analyze failure does not fail the whole request
- **GIVEN** a workspace with two pipelines, one of which fails to analyze (e.g. its source DataType was
  deleted)
- **WHEN** the owner calls `GET /api/workspace/context`
- **THEN** the response is still `200`, the failing pipeline's entry has `steps: []` and a non-empty
  `stepsError`, and the other pipeline's entry reports its steps normally

### Requirement: Bounded sample rows per pipeline-output DataType
Each `dataTypes[]` entry SHALL carry a `sampleRows` field: up to 5 rows read from the DataType's latest
pipeline-run snapshot, each row limited to the first 40 of the DataType's declared *Structured-category*
columns (in field order) — `Content`-category columns (`string-body`/`binary-ref`, HEL-217) SHALL be
excluded from `sampleRows` entirely — with any remaining cell value exceeding 200 characters truncated. A
DataType with no run snapshot, or a source-companion DataType (never written to the snapshot), SHALL
report `sampleRows: []`, never an error.

#### Scenario: Pipeline-output DataType with a run snapshot reports sample rows
- **GIVEN** a pipeline-output DataType whose producing pipeline has run successfully and written more
  than 5 rows to its snapshot
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` contains exactly 5 rows, drawn from the snapshot in
  row order

#### Scenario: DataType with no run snapshot reports an empty array
- **GIVEN** a pipeline-output DataType whose pipeline has never run successfully
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` is `[]`

#### Scenario: Source-companion DataType reports an empty array without a row query
- **GIVEN** a source-companion DataType (`sourceId` present)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` is `[]`

### Requirement: Sample-row size caps enforced by construction
Sample rows SHALL be bounded independently of workspace or DataType size: at most 5 rows (bounded at the
database query via `LIMIT`), at most the first 40 declared Structured-category columns per row, and at
most 200 characters per cell value (oversized values truncated to a `"…[truncated]"`-suffixed string),
regardless of how many rows, columns, or how large any individual stored value actually is. Content-
category column values SHALL be excluded from the database query itself (not fetched then discarded), so
that a Content field's stored size never affects the cost of assembling `sampleRows`.

#### Scenario: Oversized cell value is truncated
- **GIVEN** a DataType snapshot row containing a string value longer than 200 characters in a
  Structured-category column
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `sampleRows[].<column>` value is truncated to at most 200 characters plus
  the `"…[truncated]"` marker

#### Scenario: Wide DataType caps sample-row columns
- **GIVEN** a DataType with more than 40 declared Structured-category fields
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** each entry in the corresponding `dataTypes[].sampleRows` contains keys for at most the first
  40 of that DataType's declared Structured-category fields, in field order

#### Scenario: Content-category field value never appears in sample rows
- **GIVEN** a pipeline-output DataType with a `string-body` (or `binary-ref`) column whose stored value
  exceeds 200 characters
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** no entry in the corresponding `dataTypes[].sampleRows` contains a key for that column

### Requirement: Sample rows are owner-scoped
Sample rows SHALL only be readable by the DataType's owner, via the same ownership check
(`findByIdOwned`) the existing `GET /api/types/:id/rows` endpoint already performs — no new code path
bypasses this check.

#### Scenario: A caller never sees another user's sample rows
- **GIVEN** user A owns a pipeline-output DataType with a run snapshot, and user B owns a distinct
  pipeline-output DataType with its own run snapshot
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** the response's `dataTypes[]` entries contain only user B's own sample rows, never user A's

