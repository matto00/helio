## ADDED Requirements

### Requirement: get_workspace_context advertises the metric catalog

`buildWorkspaceContext` SHALL include a `metrics` array — one entry per metric the caller owns,
fetched via the existing `api.listMetrics()` (HEL-541) as an additional call alongside the existing
`Promise.all` fan-out (data sources, DataTypes, dashboards, pipelines, pipeline shapes). Each entry
SHALL carry `id`, `name`, `dataTypeId`, `measureField`, `aggregation`, `allowedDimensions`, `format`,
and `deprecated`, mirroring `MetricDefinition`'s own field names verbatim (`dataTypeId`, not a
renamed/aliased field). The `get_workspace_context` tool description (`helio-mcp/src/tools/read.ts`)
SHALL document the `metrics` field.

#### Scenario: Workspace context includes the metric catalog

- **WHEN** an agent calls `get_workspace_context` as a user who owns one or more defined metrics
- **THEN** the response includes a `metrics` array with one entry per owned metric, each carrying
  `id`, `name`, `dataTypeId`, `measureField`, `aggregation`, `allowedDimensions`, `format`, and
  `deprecated`

#### Scenario: Empty metric catalog returns an empty array, not an error

- **WHEN** an agent calls `get_workspace_context` as a user who owns no defined metrics
- **THEN** the response includes `metrics: []`, and the call otherwise succeeds normally

#### Scenario: A deprecated metric is still included, flagged

- **WHEN** an agent calls `get_workspace_context` as a user who owns a metric with `deprecated: true`
- **THEN** the corresponding `metrics[]` entry is present with `deprecated: true` (not omitted)
