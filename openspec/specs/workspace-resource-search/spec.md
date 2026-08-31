# workspace-resource-search Specification

## Purpose
Bounded, keyword-search primitives (`find`/`get_resource`) over the workspace's data sources,
DataTypes, pipelines, dashboards, and metrics — compact summaries for a broad query, full
per-resource detail for one targeted id — exposed as Claude tool schemas so the top-level workspace
assistant (HEL-659) can fetch only what's relevant to a conversational turn instead of
`WorkspaceContextService`'s full eager workspace dump.

## Requirements

### Requirement: A keyword search finds compact resource summaries
`WorkspaceSearchService.find(user, query, resourceTypes?)` SHALL return compact summaries (id,
resource type, name, one-line description) for every owned resource across data sources, DataTypes,
pipelines, dashboards, and metrics whose name or description contains `query` as a case-insensitive
substring, restricted to `resourceTypes` when supplied. It SHALL return an empty result, not an
error, when nothing matches.

#### Scenario: A query matching an existing resource's name returns its summary
- **WHEN** `find` is called with a query that is a substring of an owned dashboard's name
- **THEN** the result includes a summary for that dashboard with its id, `resourceType ==
  "dashboard"`, its name, and a non-empty description

#### Scenario: A query matching nothing returns an empty result, not an error
- **WHEN** `find` is called with a query that matches no owned resource's name or description
- **THEN** the result is an empty collection

#### Scenario: resourceTypes restricts which types are searched
- **WHEN** `find` is called with `resourceTypes = Some(Set(Metric))` and a query matching both an
  owned metric's name and an owned dashboard's name
- **THEN** the result includes the metric summary and excludes the dashboard summary

### Requirement: find's result set is bounded, never unbounded
`WorkspaceSearchService.find` SHALL cap its returned result set at a fixed, named top-K limit,
regardless of how many owned resources match `query` across the requested types.

#### Scenario: A query matching more resources than the top-K limit is truncated
- **WHEN** `find` is called with a query matching more owned resources than the configured top-K
  limit
- **THEN** the result contains at most that many summaries, deterministically selected (not an
  arbitrary/unstable subset across repeated calls with the same data)

### Requirement: get_resource fetches full detail for one resource, matching WorkspaceContextService's own level of detail
`WorkspaceSearchService.getResource(user, id, resourceType)` SHALL return the same level of detail
`WorkspaceContextService` already assembles for that resource type today (data source, DataType
columns/sample rows/stats, pipeline steps, dashboard panel count), reusing that existing assembly
logic rather than re-implementing it, plus a metric definition (name, description, measureField,
aggregation, allowedDimensions, format, deprecated) for the metric type. It SHALL return
`Left(ServiceError.NotFound(_))` for an id that doesn't exist or isn't owned by `user`, never an
exception.

#### Scenario: get_resource on an owned DataType returns the same detail WorkspaceContextService would
- **WHEN** `getResource` is called for an owned pipeline-output DataType's id
- **THEN** the result's columns, sample rows, and column stats match what
  `WorkspaceContextService.assemble` would produce for that same DataType

#### Scenario: get_resource on a deleted or unowned id returns NotFound, not an exception
- **WHEN** `getResource` is called with an id that does not exist, or exists but is owned by a
  different user
- **THEN** the result is `Left(ServiceError.NotFound(_))`

#### Scenario: get_resource on a pipeline shared with (but not owned by) the caller still returns NotFound
- **WHEN** `getResource` is called for a pipeline id that has been shared with the caller as an
  editor or viewer, but is owned by a different user
- **THEN** the result is `Left(ServiceError.NotFound(_))` — `getResource` is strictly owner-scoped
  for every resource type, matching `find`'s own owner-only listings, even where the underlying
  per-id lookup (`PipelineService.findSummaryById`) is itself sharing-aware

#### Scenario: get_resource on a metric returns its definition
- **WHEN** `getResource` is called for an owned metric's id
- **THEN** the result includes that metric's name, description, measureField, aggregation,
  allowedDimensions, format, and deprecated flag

### Requirement: find and get_resource are exposed as Claude tool schemas
`WorkspaceAssistantTools` SHALL define `find`/`get_resource` as `ClaudeTool` values (HEL-660's
`ClaudeTool(name, description, inputSchema)` shape) with JSON Schema `inputSchema`s matching
`find(query, resourceTypes?)` / `get_resource(id, type)`, ready to be included in a
`sendWithTools` call's `tools` list.

#### Scenario: Tool schemas are well-formed ClaudeTool values
- **WHEN** `WorkspaceAssistantTools.findTool` and `WorkspaceAssistantTools.getResourceTool` are
  inspected
- **THEN** each has a non-blank `name` matching its tool ("find"/"get_resource"), a non-blank
  `description`, and an `inputSchema` that is a valid JSON Schema object naming its parameters

### Requirement: WorkspaceContextService's existing behavior is unaffected
`find`/`get_resource` SHALL compose over the same resource surface `WorkspaceContextService`
already assembles for `get_workspace_context`, now sourced from pipelines' Outputs and sources'
`inferredSchema` instead of DataTypes/Metrics; pre-existing dashboard/pipeline/source search
behavior SHALL otherwise remain unchanged.

#### Scenario: Metrics are no longer a searchable kind; the `dataType` kind is retained as a transitional label now carrying Outputs
- **WHEN** `find` is called after the outputs-model migration
- **THEN** its result kinds no longer include `metric` (Metrics were deleted outright); the
  `dataType` result kind is RETAINED as a transitional wire label — its results are now sourced
  from `OutputRepository` rather than the deleted `DataTypeRepository`. Renaming this wire value
  is deferred to whichever P1.4-adjacent ticket rewires the 30+ frontend/MCP consumers of
  `dataType`-kind search results (see design.md's wire-naming exemption list); it is not part of
  this migration's scope

#### Scenario: Dashboard/pipeline/source search is unaffected
- **WHEN** `find` searches for a dashboard, pipeline, or source name
- **THEN** results are unchanged from before this migration

#### Scenario: WorkspaceContextService's existing test suite is unaffected
- **WHEN** the existing `WorkspaceContextServiceSpec` suite (and its sibling specs) is run after
  this change
- **THEN** every existing test passes unmodified (rewritten to source pipelines'/sources'
  Output/inferredSchema data instead of DataTypes/Metrics, but asserting equivalent behavior)
