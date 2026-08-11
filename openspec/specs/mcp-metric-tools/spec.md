# mcp-metric-tools Specification

## Purpose
Expose the HEL-493 `/api/metrics` REST API as MCP tools so an agent can list, inspect, create,
update, and delete DEFINED metrics — the reusable semantic-layer measures a panel should
reference instead of re-deriving a measure inline per panel.
## Requirements
### Requirement: list_metrics MCP tool
The MCP server SHALL expose a `list_metrics` tool that accepts optional `limit`/`offset` and calls
`GET /api/metrics`, returning the server's paginated envelope (`items`, `total`, `offset`,
`limit`) verbatim.

#### Scenario: Agent lists defined metrics
- **WHEN** an agent calls `list_metrics` with no arguments
- **THEN** the tool returns the caller-owned metrics as a paginated envelope, unmodified from the
  server response

### Requirement: get_metric MCP tool
The MCP server SHALL expose a `get_metric` tool that accepts a `metricId` and calls
`GET /api/metrics/:id`, returning the metric verbatim, or surfacing the server's 404 via the
`guarded` error path when the id does not resolve to a caller-owned metric.

#### Scenario: Agent fetches one metric
- **WHEN** an agent calls `get_metric` with a valid `metricId`
- **THEN** the tool returns that metric's full record, including `format` and `allowedDimensions`

### Requirement: create_metric MCP tool
The MCP server SHALL expose a `create_metric` tool that accepts `dataTypeId`, `name`, optional
`description`, `measureField`, `aggregation`, `allowedDimensions`, and optional `format`, validates
`aggregation` client-side against the enum `sum|avg|min|max|count|countDistinct` before issuing
`POST /api/metrics`, and returns the created metric. The tool's description SHALL state that
`dataTypeId` must be a caller-owned pipeline-output DataType (V41: `sourceId` absent) and that a
defined metric is the reusable measure a panel should reference instead of re-deriving one inline.

#### Scenario: Agent creates a metric over a pipeline-output DataType
- **WHEN** an agent calls `create_metric` with a valid `dataTypeId`, `measureField`, and
  `aggregation: "sum"`
- **THEN** the tool posts to `POST /api/metrics` and returns the created metric with its `id`

#### Scenario: Invalid aggregation rejected before any HTTP call
- **WHEN** an agent calls `create_metric` with `aggregation: "median"` (not in the allow-list)
- **THEN** the tool's Zod schema rejects the call and no request reaches the backend

#### Scenario: Server-side binding rejection surfaces verbatim
- **WHEN** an agent calls `create_metric` with a `dataTypeId` that is not a caller-owned
  pipeline-output DataType, or a `measureField`/`allowedDimensions` entry not present on that
  DataType
- **THEN** the tool returns the backend's descriptive rejection message via the `guarded` error
  path, and no metric is created

### Requirement: update_metric MCP tool
The MCP server SHALL expose an `update_metric` tool that accepts a `metricId` plus optional
`name`, `description` (nullable), `measureField`, `aggregation`, `allowedDimensions`, `format`
(nullable), and `deprecated`, and calls `PATCH /api/metrics/:id` with a body that includes a key
only when the caller supplied it — an omitted argument leaves that field unchanged server-side; an
explicit `null` on `description` or `format` clears that field.

#### Scenario: Partial update leaves other fields unchanged
- **WHEN** an agent calls `update_metric` with only `metricId` and `name`
- **THEN** the tool sends a PATCH body containing only `name`, and the metric's other fields are
  unchanged server-side

#### Scenario: Explicit null clears an optional field
- **WHEN** an agent calls `update_metric` with `description: null`
- **THEN** the tool sends a PATCH body with `description: null`, and the server clears the
  metric's description

#### Scenario: Invalid aggregation rejected before any HTTP call
- **WHEN** an agent calls `update_metric` with `aggregation: "median"`
- **THEN** the tool's Zod schema rejects the call and no request reaches the backend

### Requirement: delete_metric MCP tool
The MCP server SHALL expose a `delete_metric` tool that accepts a `metricId`, calls
`DELETE /api/metrics/:id`, and returns `{ deleted: true, id: metricId }`, matching the existing
delete-tool response convention (`deleteDashboard`/`deleteDataSource`/etc.).

#### Scenario: Agent deletes a metric
- **WHEN** an agent calls `delete_metric` with a valid `metricId`
- **THEN** the tool issues the DELETE request and returns `{ deleted: true, id: metricId }`

