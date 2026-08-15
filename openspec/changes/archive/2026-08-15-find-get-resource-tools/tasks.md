## 1. Backend: WorkspaceContextService visibility + missing findById wrappers

- [x] 1.1 Widen `WorkspaceContextService.toDataSourceEntry`/`toDataTypeEntry`/`toDashboardEntry`
      from `private` to `private[services]` (mirrors the existing `buildPipeline` precedent) — no
      behavior change
- [x] 1.2 Add `DashboardService.findById(id: DashboardId, user): Future[Either[ServiceError,
      Dashboard]]`, mirroring `DataTypeService.findById`'s exact shape over
      `DashboardRepository.findByIdOwned`
- [x] 1.3 Add `DataSourceService.findById(id: DataSourceId, user): Future[Either[ServiceError,
      DataSource]]`, mirroring `DataTypeService.findById`'s exact shape over
      `DataSourceRepository.findByIdOwned`

## 2. Backend: Domain/wire types

- [x] 2.1 Add `WorkspaceResourceType` (sealed trait: `DataSource`, `DataType`, `Pipeline`,
      `Dashboard`, `Metric`) with `fromString`/`asString`, mirroring `DataFieldType.fromString`
- [x] 2.2 Add `WorkspaceResourceSummary(id: String, resourceType: String, name: String,
      description: String)` — `find`'s compact result shape
- [x] 2.3 Add `WorkspaceResourceMetric(id, name, description, measureField, aggregation,
      allowedDimensions, format, deprecated)` — metric's `getResource` detail shape (no existing
      `WorkspaceContext*` analog to reuse)
- [x] 2.4 Add a sealed `WorkspaceResourceDetail` wrapping `WorkspaceContextDataSource` /
      `WorkspaceContextDataType` / `WorkspaceContextPipeline` / `WorkspaceContextDashboard`
      (reused verbatim) / the new `WorkspaceResourceMetric`
- [x] 2.5 spray-json formatters for the 3 new types (`WorkspaceResourceSummary`,
      `WorkspaceResourceMetric`, `WorkspaceResourceDetail`), reusing existing
      `WorkspaceContextProtocol` formatters for the 4 wrapped cases

## 3. Backend: WorkspaceSearchService

- [x] 3.1 Create `WorkspaceSearchService(dashboardService, dataSourceService, dataTypeService,
      pipelineService, metricService, workspaceContextService)(implicit ec)` in
      `com.helio.services`
- [x] 3.2 Implement `find(user, query, resourceTypes: Option[Set[WorkspaceResourceType]] = None):
      Future[Vector[WorkspaceResourceSummary]]`: fan out to each requested type's `findAll`/
      `listSummaries`/`MetricService.findAll`, case-insensitive substring match on name +
      synthesized/real description (design.md D5), map to `WorkspaceResourceSummary`
- [x] 3.3 Implement per-type description synthesis exactly per design.md D5 (data source: `"<kind>
      data source"`; DataType: pipeline-output vs. source-companion; pipeline: `"<source> →
      <output>"`; dashboard: `"dashboard, <N> panels"`; metric: real description, falling back to
      `"<aggregation> of <measureField>"`)
- [x] 3.3a Add `MaxFindResults: Int = 20` (named, doc-commented constant, design.md D1a) and sort
      matches by name-match-position ascending then `(resourceType, name)` ascending before
      truncating to `MaxFindResults` — `find` must never return an unbounded result set
- [x] 3.4 Implement `getResource(user, id, resourceType: WorkspaceResourceType):
      Future[Either[ServiceError, WorkspaceResourceDetail]]`: dispatch by type to the appropriate
      service's `findById` + `workspaceContextService`'s (now `private[services]`) per-entry
      converter for the 4 existing types; build `WorkspaceResourceMetric` directly from
      `MetricDefinition` for the 5th; `Left(ServiceError.NotFound(_))` when the underlying lookup
      misses
- [x] 3.5 For the pipeline case, call `PipelineService.findSummaryById` then reuse
      `workspaceContextService.buildPipeline` (already `private[services]`) for detail — but filter
      the summary on `summary.ownerId.contains(user.id.value)` BEFORE building detail, returning
      `Left(NotFound)` otherwise (design.md D1b): `findSummaryById` is sharing-aware (owner/editor/
      viewer), while `getResource` must stay strictly owner-only like every other resource type

## 4. Backend: Claude tool schemas

- [x] 4.1 Add `WorkspaceAssistantTools` (colocated with `WorkspaceSearchService`) defining
      `findTool: ClaudeTool` and `getResourceTool: ClaudeTool` (HEL-660's `ClaudeTool(name,
      description, inputSchema: JsValue)`), with hand-built JSON Schema `inputSchema`s matching
      `find(query, resourceTypes?)` / `get_resource(id, type)` per the design spec's exact tool
      signatures

## 5. Tests

- [x] 5.1 Test: `find` returns a summary for a query matching an owned resource's name, for each of
      the 5 resource types
- [x] 5.2 Test: `find` returns an empty result (not an error) for a query matching nothing
- [x] 5.3 Test: `find`'s `resourceTypes` filter restricts which types are searched
- [x] 5.3a Test: a query matching more than `MaxFindResults` owned resources returns at most
      `MaxFindResults` summaries
- [x] 5.3b Test: `getResource` on a pipeline shared with (but not owned by) the caller returns
      `Left(NotFound)`, not the shared pipeline's detail
- [x] 5.4 Test: `getResource` on an owned DataType returns the same columns/sample rows/column
      stats `WorkspaceContextService.assemble` would produce for that DataType (cross-check against
      an `assemble` call in the same test)
- [x] 5.5 Test: `getResource` on a nonexistent or unowned id returns `Left(NotFound)`, not an
      exception, for each of the 5 resource types
- [x] 5.6 Test: `getResource` on a metric returns its full definition (name, description,
      measureField, aggregation, allowedDimensions, format, deprecated)
- [x] 5.7 Test: `WorkspaceAssistantTools.findTool`/`getResourceTool` are well-formed `ClaudeTool`
      values (non-blank name/description, valid JSON Schema `inputSchema`)
- [x] 5.8 Test: the existing `WorkspaceContextServiceSpec` suite (and siblings) passes unmodified
      after the `private[services]` visibility widening
- [x] 5.9 Test: `DashboardService.findById`/`DataSourceService.findById` — found, not-found, and
      not-owned-by-caller cases
