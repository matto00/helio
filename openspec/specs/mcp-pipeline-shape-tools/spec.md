# mcp-pipeline-shape-tools Specification

## Purpose
Let MCP agents discover the smart pipeline shape catalog and instantiate a shape into a running
pipeline + bindable output DataType, so `create_pipeline`/`propose_dashboard` flows can build on a
pre-validated shape instead of hand-assembling raw pipeline steps.
## Requirements
### Requirement: list_pipeline_shapes exposes the shape catalog

The MCP server SHALL register a `list_pipeline_shapes` tool that calls `GET /api/pipeline-shapes` and
returns the response verbatim. Its description SHALL name every shape id registered on `main`
(`passthrough`/`single-row`/`top-n`/`time-series`/`pivot-matrix`) and note that `outputContract.fields`
is currently always empty (descriptive `rowCount`/`description` carry the real signal — do not treat an
empty `fields` array as an error).

#### Scenario: Agent lists available shapes
- **WHEN** an agent calls `list_pipeline_shapes`
- **THEN** the tool returns the catalog array with `id`/`label`/`description`/`paramsSchema`/
  `outputContract` for at least the `single-row`, `top-n`, `time-series`, and `pivot-matrix` entries

### Requirement: create_pipeline_from_shape instantiates a shape into a pipeline

The MCP server SHALL register a `create_pipeline_from_shape` tool accepting `name`,
`sourceDataSourceId`, `outputDataTypeName`, `shapeId`, and `params` (a free-form object passed to the
shape's `expand`). The tool SHALL call `POST /api/pipeline-shapes/:shapeId/expand` with `{params}`
BEFORE creating any pipeline or step. On success, it SHALL create the pipeline (`POST /api/pipelines`)
and then add each returned `{kind, config}` expansion as a step, in the order returned, via the same
step-create call `add_pipeline_step` uses. It SHALL return the created pipeline summary plus the ordered
list of created steps. It SHALL NOT run the pipeline — `run_pipeline` remains a separate, explicit call.

#### Scenario: Valid shape id and params produce a pipeline with expanded steps
- **WHEN** an agent calls `create_pipeline_from_shape` with a registered `shapeId` (e.g. `"top-n"`) and
  params that satisfy that shape's `expand`
- **THEN** the tool returns a pipeline summary (with `id` and `outputDataTypeId`) plus the steps
  `expand` produced (e.g. `sort` then `limit` for `top-n`), created on the new pipeline in that order

#### Scenario: No pipeline is created when expand fails
- **WHEN** an agent calls `create_pipeline_from_shape` with params that fail the shape's own `expand`
  validation (e.g. `top-n` missing `n`)
- **THEN** the tool returns an error whose message is the shape's own validation message (surfaced from
  the backend's 422 verbatim, via the existing `HelioApiError`/`guarded` error path), and no pipeline is
  created

#### Scenario: Unknown shape id is rejected before any write
- **WHEN** an agent calls `create_pipeline_from_shape` with a `shapeId` not present in the catalog
- **THEN** the tool returns an error whose message lists the registered shape ids (the backend's 404
  message verbatim), and no pipeline is created

### Requirement: get_workspace_context advertises the shape catalog

`buildWorkspaceContext` SHALL include a `pipelineShapes` array — one entry per registered shape, each
carrying `id`, `label`, `description`, `paramsSchema`, `outputRowCount` (a flattened string derived from
the shape's `RowCountContract`: `"exactly-one"`, `"at-most-param:<paramName>"`, or `"unbounded"`), and
`outputDescription`. This fan-out SHALL be a single additional call (not per-pipeline), alongside the
existing four `Promise.all` calls.

#### Scenario: Workspace context includes the shape catalog
- **WHEN** an agent calls `get_workspace_context`
- **THEN** the response includes a `pipelineShapes` array containing an entry for each registered shape
  id, with a flattened `outputRowCount` string and no raw `fields` array

