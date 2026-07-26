## MODIFIED Requirements

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
