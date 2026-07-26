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

