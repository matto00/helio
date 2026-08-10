# metric-crud-api Specification

## Purpose
Exposes HEL-446's `MetricDefinition`/`MetricRepository` over REST (`/api/metrics`), so the
frontend, the MCP surface, and the agent can create, list, read, patch, and delete owner-scoped
named metrics bound to pipeline-output DataTypes.
## Requirements
### Requirement: List metrics
`GET /api/metrics` SHALL return the caller's own metrics only, RLS-scoped, wrapped in the
existing `PaginatedQueryResult` envelope (`items`/`total`/`offset`/`limit`), honoring `offset`
and `limit` query params the same way `GET /api/types` does.

#### Scenario: Owner sees only their own metrics
- **WHEN** user A calls `GET /api/metrics` after creating two metrics, while user B has created one
- **THEN** the response's `items` contains exactly user A's two metrics and `total` is 2

### Requirement: Create metric
`POST /api/metrics` SHALL create a metric bound to a caller-owned, pipeline-output DataType,
after validating `name` is non-empty, `dataTypeId` resolves to a caller-owned DataType with
`sourceId == None`, `measureField` and every `allowedDimensions` entry are fields of that
DataType, and `aggregation` is one of `sum|avg|min|max|count|countDistinct`.

#### Scenario: Successful create
- **WHEN** the caller POSTs a well-formed request naming a pipeline-output DataType they own
- **THEN** the response is `201 Created` with the new metric, owned by the caller

#### Scenario: Reject non-owned or non-pipeline-output dataTypeId
- **WHEN** the caller POSTs a request whose `dataTypeId` does not resolve to a DataType they own
  with `sourceId == None`
- **THEN** the response is `422 Unprocessable Entity` with a descriptive message

#### Scenario: Reject measureField or allowedDimensions not in the DataType's fields
- **WHEN** the caller POSTs a request whose `measureField`, or any entry of `allowedDimensions`,
  is not a field name of the bound DataType
- **THEN** the response is `422 Unprocessable Entity` with a descriptive message

#### Scenario: Reject aggregation outside the allow-list
- **WHEN** the caller POSTs a request whose `aggregation` is not one of
  `sum|avg|min|max|count|countDistinct`
- **THEN** the response is `422 Unprocessable Entity` with a descriptive message

#### Scenario: Reject empty name
- **WHEN** the caller POSTs a request whose `name` is empty or whitespace-only
- **THEN** the response is `400 Bad Request` with a descriptive message

### Requirement: Get metric
`GET /api/metrics/:id` SHALL return the metric when it exists and is owned by the caller, and
`404 Not Found` otherwise (including when it exists but belongs to a different owner).

#### Scenario: Owner fetches their own metric
- **WHEN** the caller GETs a metric they own
- **THEN** the response is `200 OK` with that metric

#### Scenario: Non-owner cannot fetch another user's metric
- **WHEN** the caller GETs a metric owned by a different user
- **THEN** the response is `404 Not Found`

### Requirement: Update metric (partial)
`PATCH /api/metrics/:id` SHALL apply a partial update using the absent-vs-null convention already
used by `MetricPanelConfig.Patch`: a field absent from the request body leaves the current value
unchanged; for `description` and `format`, an explicit `null` clears the field. Every field named
in the request body (`name`, `description`, `measureField`, `aggregation`, `allowedDimensions`,
`format`, `deprecated`) SHALL be independently patchable this way. The merged result SHALL be
re-validated against the same rules as create.

#### Scenario: Absent field leaves value unchanged
- **WHEN** the caller PATCHes only `{"name": "New Name"}` on a metric with an existing
  `description`
- **THEN** the response's `name` is updated and `description` is unchanged

#### Scenario: Explicit null clears a nullable field
- **WHEN** the caller PATCHes `{"description": null}` on a metric with an existing `description`
- **THEN** the response's `description` is absent/null

#### Scenario: Patched aggregation is re-validated
- **WHEN** the caller PATCHes `{"aggregation": "median"}`, which is not in the allow-list
- **THEN** the response is `422 Unprocessable Entity` and the metric is not modified

### Requirement: Delete metric
`DELETE /api/metrics/:id` SHALL delete the metric when owned by the caller and return
`204 No Content`; SHALL return `404 Not Found` when the metric does not exist or is owned by a
different caller.

#### Scenario: Owner deletes their own metric
- **WHEN** the caller DELETEs a metric they own
- **THEN** the response is `204 No Content` and the metric no longer appears in subsequent list/get calls

#### Scenario: Non-owner cannot delete another user's metric
- **WHEN** the caller DELETEs a metric owned by a different user
- **THEN** the response is `404 Not Found` and the metric is not deleted

