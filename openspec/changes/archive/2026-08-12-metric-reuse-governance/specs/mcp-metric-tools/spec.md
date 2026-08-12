## MODIFIED Requirements

### Requirement: get_workspace_context advertises the metric catalog

`buildWorkspaceContext` SHALL include a `metrics` array — one entry per **non-deprecated** metric the
caller owns (`deprecated !== true`), fetched via the existing `api.listMetrics()` (HEL-541) as an
additional call alongside the existing `Promise.all` fan-out (data sources, DataTypes, dashboards,
pipelines, pipeline shapes). Each entry SHALL carry `id`, `name`, `dataTypeId`, `measureField`,
`aggregation`, `allowedDimensions`, `format`, and `deprecated` (always `false` for an included entry,
carried for wire-shape stability), mirroring `MetricDefinition`'s own field names verbatim (`dataTypeId`,
not a renamed/aliased field). The `get_workspace_context` tool description (`helio-mcp/src/tools/read.ts`)
SHALL document the `metrics` field and its deprecated-exclusion behavior. The `list_metrics` MCP tool
(direct `GET /api/metrics` passthrough) SHALL NOT be affected — it continues to return every metric,
deprecated or not, since it is the tool an agent uses to actively manage metrics.

#### Scenario: Workspace context includes non-deprecated metrics

- **WHEN** an agent calls `get_workspace_context` as a user who owns one or more non-deprecated
  defined metrics
- **THEN** the response includes a `metrics` array with one entry per owned non-deprecated metric, each
  carrying `id`, `name`, `dataTypeId`, `measureField`, `aggregation`, `allowedDimensions`, `format`,
  and `deprecated: false`

#### Scenario: Empty metric catalog returns an empty array, not an error

- **WHEN** an agent calls `get_workspace_context` as a user who owns no defined metrics
- **THEN** the response includes `metrics: []`, and the call otherwise succeeds normally

#### Scenario: A deprecated metric is excluded from the grounding catalog

- **WHEN** an agent calls `get_workspace_context` as a user who owns a metric with `deprecated: true`
  alongside other non-deprecated metrics
- **THEN** the `metrics` array does not contain an entry for the deprecated metric, while entries for
  the non-deprecated metrics are still present

#### Scenario: list_metrics still returns deprecated metrics

- **WHEN** an agent calls `list_metrics` as a user who owns a metric with `deprecated: true`
- **THEN** the returned paginated envelope still includes that metric, unaffected by the grounding
  catalog's exclusion
