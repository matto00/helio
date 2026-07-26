package com.helio.services

import com.helio.api.protocols.{
  AnalyzeStepResponse,
  PipelineSummaryResponse,
  WorkspaceContextColumn,
  WorkspaceContextComputedColumn,
  WorkspaceContextCounts,
  WorkspaceContextDashboard,
  WorkspaceContextDataSource,
  WorkspaceContextDataType,
  WorkspaceContextPipeline,
  WorkspaceContextPipelineStep,
  WorkspaceContextResponse
}
import com.helio.domain.{AuthenticatedUser, DashboardLayout, DataSource, DataType, Dashboard, Page, PipelineId}
import com.helio.infrastructure.DataTypeRepository

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Server-side port of `helio-mcp/src/context.ts`'s `buildWorkspaceContext`
 *  (HEL-371). Composes the caller's EXISTING owner-scoped
 *  services/repositories — `DashboardService`, `DataSourceService`,
 *  `DataTypeRepository`, `PipelineService` — and performs no direct database
 *  access of its own (design.md D1), mirroring `DashboardProposalService`'s
 *  composition discipline. Every read therefore inherits the owner-scoping
 *  already proven by those methods' own tests; a scoped PAT is denied before
 *  this service is ever reached (`AuthDirectives.confineScopedToken`,
 *  design.md D6). */
final class WorkspaceContextService(
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    dataTypeRepo: DataTypeRepository,
    pipelineService: PipelineService
)(implicit ec: ExecutionContext) {

  /** Assembles one snapshot of the caller's workspace. `dataSources`/
   *  `dataTypes`/`dashboards` use `Page.Default` (200 — design.md D3, parity
   *  with the MCP's own unparameterized fan-out); `counts` always reports
   *  each list call's true `PagedResult.total`, so truncation past 200 items
   *  is detectable even though this ticket doesn't solve it (D3). */
  def assemble(user: AuthenticatedUser): Future[WorkspaceContextResponse] = {
    val sourcesF    = dataSourceService.findAll(user, Page.Default)
    val typesF      = dataTypeRepo.findAll(user.id, Page.Default)
    val dashboardsF = dashboardService.findAll(user, Page.Default)
    val summariesF  = pipelineService.listSummaries(user)

    for {
      sourcesPage    <- sourcesF
      typesPage      <- typesF
      dashboardsPage <- dashboardsF
      summaries      <- summariesF
      pipelines      <- Future.traverse(summaries)(buildPipeline(_, user))
    } yield WorkspaceContextResponse(
      generatedAt = Instant.now().toString,
      counts = WorkspaceContextCounts(
        dataSources = sourcesPage.total,
        dataTypes   = typesPage.total,
        pipelines   = summaries.size,
        dashboards  = dashboardsPage.total
      ),
      dataSources = sourcesPage.items.map(toDataSourceEntry),
      dataTypes   = typesPage.items.map(toDataTypeEntry),
      pipelines   = pipelines,
      dashboards  = dashboardsPage.items.map(toDashboardEntry)
    )
  }

  /** Per-pipeline `analyze` fan-out (design.md D5 — parallel via
   *  `Future.traverse`, not batched; `analyze` is DB-cheap, no Spark job). An
   *  individual failure — either a `Left(ServiceError)` from `analyze` or an
   *  unexpected thrown exception — degrades ONLY this pipeline's entry to
   *  `steps: []` + `stepsError`, mirroring `context.ts`'s per-pipeline
   *  `try/catch`, never failing the whole assembly.
   *
   *  `private[services]` (not `private`) rather than fully private so
   *  `WorkspaceContextServiceSpec` can exercise the degrade path directly for
   *  a summary whose pipeline has since been deleted (tasks.md 4.5) — the
   *  race between `listSummaries` and a per-id `analyze` that this guards
   *  against isn't reproducible deterministically through `assemble` alone
   *  over a single real Postgres instance. */
  private[services] def buildPipeline(
      summary: PipelineSummaryResponse,
      user: AuthenticatedUser
  ): Future[WorkspaceContextPipeline] =
    pipelineService.analyze(PipelineId(summary.id), user)
      .map {
        case Right(analyzed) => toPipelineEntry(summary, analyzed.steps.map(toStepEntry), stepsError = None)
        case Left(err)       => toPipelineEntry(summary, Vector.empty, stepsError = Some(err.message))
      }
      .recover { case ex =>
        toPipelineEntry(summary, Vector.empty, stepsError = Some(Option(ex.getMessage).getOrElse(ex.getClass.getName)))
      }

  private def toStepEntry(s: AnalyzeStepResponse): WorkspaceContextPipelineStep =
    WorkspaceContextPipelineStep(
      position        = s.position,
      `type`          = s.`type`,
      outputColumns   = s.outputSchema.map(_.name),
      validationError = s.validationError
    )

  private def toPipelineEntry(
      summary: PipelineSummaryResponse,
      steps: Vector[WorkspaceContextPipelineStep],
      stepsError: Option[String]
  ): WorkspaceContextPipeline =
    WorkspaceContextPipeline(
      id                   = summary.id,
      name                 = summary.name,
      sourceDataSourceId   = summary.sourceDataSourceId,
      sourceDataSourceName = summary.sourceDataSourceName,
      outputDataTypeId     = summary.outputDataTypeId,
      outputDataTypeName   = summary.outputDataTypeName,
      lastRunStatus        = summary.lastRunStatus,
      lastRunAt            = summary.lastRunAt,
      lastRunRowCount      = summary.lastRunRowCount,
      tag                  = summary.tag,
      steps                = steps,
      stepsError           = stepsError
    )

  private def toDataSourceEntry(ds: DataSource): WorkspaceContextDataSource =
    WorkspaceContextDataSource(id = ds.id.value, name = ds.name, `type` = ds.kind, tag = ds.tag)

  /** `pipelineOutput = dt.sourceId.isEmpty` — classified directly off the
   *  domain field (design.md D7), never through a wire round-trip. */
  private def toDataTypeEntry(dt: DataType): WorkspaceContextDataType =
    WorkspaceContextDataType(
      id             = dt.id.value,
      name           = dt.name,
      sourceId       = dt.sourceId.map(_.value),
      pipelineOutput = dt.sourceId.isEmpty,
      columns        = dt.fields.map(f => WorkspaceContextColumn(f.name, f.dataType, f.nullable)),
      computedColumns = dt.computedFields.map(cf => WorkspaceContextComputedColumn(cf.name, cf.dataType, cf.expression)),
      version        = dt.version,
      tag            = dt.tag
    )

  private def toDashboardEntry(d: Dashboard): WorkspaceContextDashboard =
    WorkspaceContextDashboard(id = d.id.value, name = d.name, panelCount = distinctPanelCount(d.layout))

  /** Distinct panel ids referenced across all four responsive breakpoints —
   *  mirrors `context.ts`'s `panelCount` helper. */
  private def distinctPanelCount(layout: DashboardLayout): Int =
    (layout.lg ++ layout.md ++ layout.sm ++ layout.xs).map(_.panelId).toSet.size
}
