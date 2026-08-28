package com.helio.services.workspace

import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.services.metrics.MetricService
import com.helio.services.pipelines.{DataTypeService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.pipelines.PipelineSummaryResponse
import com.helio.api.protocols.workspace.{WorkspaceResourceDetail, WorkspaceResourceMetric, WorkspaceResourceSummary}
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, DataSource, DataSourceId, DataType, DataTypeId, MetricDefinition, MetricId, Page, PipelineId, WorkspaceResourceType}

import scala.concurrent.{ExecutionContext, Future}

/** HEL-661 — narrow `find`/`getResource` primitives for HEL-659's top-level assistant, backing the
 *  `WorkspaceAssistantTools` `ClaudeTool` schemas. Composes the SAME 4 services `WorkspaceContextService`
 *  already composes, plus `MetricService`, and `workspaceContextService` itself for `getResource`'s
 *  per-entry detail (design.md D1) — mirrors `WorkspaceContextService`'s own "compose services, never
 *  touch repositories directly" discipline. Does NOT replace `WorkspaceContextService`: that continues
 *  backing the unchanged `GET /api/workspace/context` route unaffected by this class.
 *
 *  `find` intentionally does NOT reuse `workspaceContextService`'s heavier per-item assembly (sample
 *  rows/column stats, per-pipeline `analyze`) — it calls each composed service's own lightweight
 *  `findAll`/`listSummaries` directly and synthesizes a one-line description per type (design.md D5),
 *  since that per-item detail would be wasteful for a keyword search. `getResource` is the opposite:
 *  it fetches exactly ONE owned resource and reuses `workspaceContextService`'s (now `private[services]`)
 *  per-entry converters for full detail, rather than duplicating that assembly logic. */
final class WorkspaceSearchService(
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    dataTypeService: DataTypeService,
    pipelineService: PipelineService,
    metricService: MetricService,
    workspaceContextService: WorkspaceContextService
)(implicit ec: ExecutionContext) {

  /** `find`'s fixed top-K result cap (design.md D1a, design-gate round-1 REFUTE fix) — `find` scans
   *  up to `Page.Default` (200) candidates per requested resource type (up to 1,000 total across all
   *  5 unfiltered), but the ticket's Scope section promises "top-K matches," not "every match." A
   *  named, doc-commented tunable, matching `WorkspaceContextService`'s own style of constants
   *  (`SampleRowLimit`/`MaxJoinHints`). `find` NEVER returns more than this many summaries. */
  private val MaxFindResults: Int = 20


  /** Keyword/substring search across the caller's own data sources, DataTypes, pipelines,
   *  dashboards, and metrics (owner-scoped throughout — every composed `findAll`/`listSummaries` call
   *  already filters by the caller, mirroring `WorkspaceContextService.assemble`'s identical
   *  discipline). `resourceTypes = None` searches all 5 types; a non-empty `Some` restricts the fan-out
   *  to only those types. Matching is case-insensitive substring containment over `name` OR the
   *  synthesized/real `description` (design.md D5). Never throws for a query matching nothing — an
   *  empty `Vector`, not an error. Result set is capped at `MaxFindResults` (design.md D1a), sorted
   *  deterministically: name-match-position ascending (a description-only match sorts after every
   *  name match), then `(resourceType, name)` ascending as a stable tie-break. */
  def find(
      user: AuthenticatedUser,
      query: String,
      resourceTypes: Option[Set[WorkspaceResourceType]] = None
  ): Future[Vector[WorkspaceResourceSummary]] = {
    def requested(t: WorkspaceResourceType): Boolean = resourceTypes.forall(_.contains(t))

    val dataSourceSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.DataSource))
        dataSourceService.findAll(user, Page.Default).map(_.items.map(toDataSourceSummary))
      else Future.successful(Vector.empty)

    val dataTypeSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.DataType))
        dataTypeService.findAll(user, Page.Default).map(_.items.map(toDataTypeSummary))
      else Future.successful(Vector.empty)

    val pipelineSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.Pipeline))
        pipelineService.listSummaries(user).map(_.map(toPipelineSummary))
      else Future.successful(Vector.empty)

    val dashboardSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.Dashboard))
        dashboardService.findAll(user, Page.Default).flatMap(page => Future.traverse(page.items)(toDashboardSummary(_, user)))
      else Future.successful(Vector.empty)

    val metricSummariesF: Future[Vector[WorkspaceResourceSummary]] =
      if (requested(WorkspaceResourceType.Metric))
        metricService.findAll(user, Page.Default).map(_.items.map(toMetricSummary))
      else Future.successful(Vector.empty)

    for {
      dataSourceSummaries <- dataSourceSummariesF
      dataTypeSummaries   <- dataTypeSummariesF
      pipelineSummaries   <- pipelineSummariesF
      dashboardSummaries  <- dashboardSummariesF
      metricSummaries     <- metricSummariesF
    } yield {
      val normalizedQuery = query.toLowerCase
      val candidates = dataSourceSummaries ++ dataTypeSummaries ++ pipelineSummaries ++ dashboardSummaries ++ metricSummaries
      val matches = candidates.filter(matchesQuery(_, normalizedQuery))
      rankAndTruncate(matches, normalizedQuery)
    }
  }

  private def matchesQuery(summary: WorkspaceResourceSummary, normalizedQuery: String): Boolean =
    summary.name.toLowerCase.contains(normalizedQuery) || summary.description.toLowerCase.contains(normalizedQuery)

  /** Deterministic top-K selection (design.md D1a): a match found earlier in `name` (lower substring
   *  index) ranks first; a match with no `name` hit at all (description-only) sorts after every
   *  `name` match via the `Int.MaxValue` sentinel below. `(resourceType, name)` ascending breaks any
   *  remaining tie — never an arbitrary/iteration-order-dependent subset across repeated calls over
   *  the same data. */
  private def rankAndTruncate(matches: Vector[WorkspaceResourceSummary], normalizedQuery: String): Vector[WorkspaceResourceSummary] = {
    def namePosition(s: WorkspaceResourceSummary): Int = {
      val idx = s.name.toLowerCase.indexOf(normalizedQuery)
      if (idx >= 0) idx else Int.MaxValue
    }
    matches.sortBy(s => (namePosition(s), s.resourceType, s.name)).take(MaxFindResults)
  }


  private def toDataSourceSummary(ds: DataSource): WorkspaceResourceSummary =
    WorkspaceResourceSummary(
      id           = ds.id.value,
      resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.DataSource),
      name         = ds.name,
      description  = s"${ds.kind} data source"
    )

  private def toDataTypeSummary(dt: DataType): WorkspaceResourceSummary =
    WorkspaceResourceSummary(
      id           = dt.id.value,
      resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.DataType),
      name         = dt.name,
      description  = if (dt.sourceId.isEmpty) "pipeline output type" else "source-companion type"
    )

  private def toPipelineSummary(p: PipelineSummaryResponse): WorkspaceResourceSummary =
    WorkspaceResourceSummary(
      id           = p.id,
      resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.Pipeline),
      name         = p.name,
      description  = s"${p.sourceDataSourceName} → ${p.outputDataTypeName}"
    )

  /** Reuses `workspaceContextService.toDashboardEntry` (widened `private[services]`, design.md D2)
   *  for its `panelCount` computation rather than duplicating `distinctPanelCount`'s layout-dedup
   *  logic here — one implementation, no drift. `Future`-returning (beta UI-audit F-004 fix) --
   *  `toDashboardEntry` now needs `user` for a real DB-backed `panelCount`. */
  private def toDashboardSummary(d: Dashboard, user: AuthenticatedUser): Future[WorkspaceResourceSummary] =
    workspaceContextService.toDashboardEntry(d, user).map { entry =>
      WorkspaceResourceSummary(
        id           = d.id.value,
        resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.Dashboard),
        name         = d.name,
        description  = s"dashboard, ${entry.panelCount} panels"
      )
    }

  private def toMetricSummary(m: MetricDefinition): WorkspaceResourceSummary =
    WorkspaceResourceSummary(
      id           = m.id.value,
      resourceType = WorkspaceResourceType.asString(WorkspaceResourceType.Metric),
      name         = m.name,
      description  = m.description.getOrElse(s"${m.aggregation} of ${m.measureField}")
    )


  /** Full per-resource detail for exactly one owned resource, dispatched by `resourceType`. Reuses
   *  `workspaceContextService`'s (now `private[services]`) per-entry converters for the 4 existing
   *  types rather than duplicating that assembly logic (design.md D1); builds `WorkspaceResourceMetric`
   *  directly from `MetricDefinition` for the 5th (no existing converter to reuse). Strictly
   *  owner-scoped for EVERY type, matching `find`'s own owner-only listings — `Left(NotFound)` for an
   *  id that doesn't exist OR isn't owned by `user`, never a leaked "exists but forbidden" signal and
   *  never an exception. */
  def getResource(
      user: AuthenticatedUser,
      id: String,
      resourceType: WorkspaceResourceType
  ): Future[Either[ServiceError, WorkspaceResourceDetail]] = resourceType match {
    case WorkspaceResourceType.DataSource =>
      dataSourceService.findById(DataSourceId(id), user).map(_.map(ds => WorkspaceResourceDetail.DataSourceDetail(workspaceContextService.toDataSourceEntry(ds))))

    case WorkspaceResourceType.DataType =>
      dataTypeService.findById(DataTypeId(id), user).flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(dt) => workspaceContextService.toDataTypeEntry(dt, user).map(entry => Right(WorkspaceResourceDetail.DataTypeDetail(entry)))
      }

    case WorkspaceResourceType.Pipeline =>
      getPipelineResource(user, PipelineId(id))

    case WorkspaceResourceType.Dashboard =>
      dashboardService.findById(DashboardId(id), user).flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(d)  => workspaceContextService.toDashboardEntry(d, user).map(entry => Right(WorkspaceResourceDetail.DashboardDetail(entry)))
      }

    case WorkspaceResourceType.Metric =>
      metricService.findById(MetricId(id), user).map(_.map(toMetricDetail))
  }

  /** `PipelineService.findSummaryById` is sharing-aware (owner, editor, and viewer grantees can
   *  read — its own doc comment) — using it unfiltered would let a pipeline shared with, but not
   *  owned by, `user` succeed, contradicting `getResource`'s own owner-only contract for every other
   *  resource type (design.md D1b, design-gate round-1 REFUTE fix). Filter on
   *  `summary.ownerId.contains(user.id.value)` BEFORE building detail — `Left(NotFound)` otherwise,
   *  same "existence not leaked" semantics as every other branch above. */
  private def getPipelineResource(user: AuthenticatedUser, pipelineId: PipelineId): Future[Either[ServiceError, WorkspaceResourceDetail]] =
    pipelineService.findSummaryById(pipelineId, user).flatMap {
      case Left(err) =>
        Future.successful(Left(err))
      case Right(summary) if !summary.ownerId.contains(user.id.value) =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Right(summary) =>
        workspaceContextService.buildPipeline(summary, user).map(entry => Right(WorkspaceResourceDetail.PipelineDetail(entry)))
    }

  private def toMetricDetail(m: MetricDefinition): WorkspaceResourceDetail =
    WorkspaceResourceDetail.MetricDetail(WorkspaceResourceMetric(
      id                = m.id.value,
      name              = m.name,
      description       = m.description,
      measureField      = m.measureField,
      aggregation       = m.aggregation,
      allowedDimensions = m.allowedDimensions,
      format            = m.format,
      deprecated        = m.deprecated
    ))
}
