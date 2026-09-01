# mcp-pipeline-shape-tools Specification

## Purpose
Let MCP agents discover the smart pipeline shape catalog and instantiate a shape into a running
pipeline + bindable output DataType, so `create_pipeline`/`propose_dashboard` flows can build on a
pre-validated shape instead of hand-assembling raw pipeline steps.

## Requirements

### Requirement: list_pipeline_shapes exposes the shape catalog

The MCP server SHALL register a `list_pipeline_shapes` tool that calls `GET /api/pipeline-shapes` and
returns the response verbatim. Its description SHALL name every shape id registered on `main`
(`passthrough`/`single-row`/`top-n`/`time-series`/`pivot-matrix`) and describe `outputContract` as
`rowCount` + `description`, noting that the `rowCount`/`description` text carries the real signal about
the shape's output. `outputContract` carries no `fields` member — a prior note in this description about
`outputContract.fields` being "currently always empty" described a field that has since been removed
entirely (HEL-623) and no longer applies.

#### Scenario: Agent lists available shapes
- **WHEN** an agent calls `list_pipeline_shapes`
- **THEN** the tool returns the catalog array with `id`/`label`/`description`/`paramsSchema`/
  `outputContract` for at least the `single-row`, `top-n`, `time-series`, and `pivot-matrix` entries, and
  each entry's `outputContract` contains only `rowCount` and `description`

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
