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
import com.helio.domain.{
  AuthenticatedUser,
  DashboardLayout,
  DataField,
  DataFieldType,
  DataSource,
  DataType,
  Dashboard,
  FieldTypeCategory,
  Page,
  PipelineId
}
import spray.json.{JsObject, JsString, JsValue}

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Server-side port of `helio-mcp/src/context.ts`'s `buildWorkspaceContext`
 *  (HEL-371). Composes the caller's EXISTING owner-scoped
 *  services — `DashboardService`, `DataSourceService`, `DataTypeService`,
 *  `PipelineService` — and performs no direct database access of its own
 *  (design.md D1), mirroring `DashboardProposalService`'s composition
 *  discipline. Every read therefore inherits the owner-scoping already
 *  proven by those methods' own tests; a scoped PAT is denied before this
 *  service is ever reached (`AuthDirectives.confineScopedToken`, design.md
 *  D6).
 *
 *  HEL-372: takes `dataTypeService: DataTypeService` rather than a bare
 *  `DataTypeRepository` (design.md D7) — `findAll` is still exactly what
 *  `DataTypeRepository.findAll` did, but `listRows`'s owner-scoping choke
 *  point (`findByIdOwned`) only exists on the service, and sample rows need
 *  it. */
final class WorkspaceContextService(
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    dataTypeService: DataTypeService,
    pipelineService: PipelineService
)(implicit ec: ExecutionContext) {

  /** Bounded sample-row count per pipeline-output DataType (design.md D1/D3)
   *  — a documented constant, never unbounded; `DataTypeRowRepository.listRows`
   *  enforces this at the SQL tier via `LIMIT`. */
  private val SampleRowLimit: Int = 5

  /** First N declared Structured-category columns retained per sample row
   *  (design.md D3). */
  private val SampleColumnLimit: Int = 40

  /** Per-cell character cap before truncation (design.md D3). */
  private val SampleCellCharLimit: Int = 200

  private val TruncationMarker: String = "…[truncated]"

  /** Assembles one snapshot of the caller's workspace. `dataSources`/
   *  `dataTypes`/`dashboards` use `Page.Default` (200 — design.md D3, parity
   *  with the MCP's own unparameterized fan-out); `counts` always reports
   *  each list call's true `PagedResult.total`, so truncation past 200 items
   *  is detectable even though this ticket doesn't solve it (D3). */
  def assemble(user: AuthenticatedUser): Future[WorkspaceContextResponse] = {
    val sourcesF    = dataSourceService.findAll(user, Page.Default)
    val typesF      = dataTypeService.findAll(user, Page.Default)
    val dashboardsF = dashboardService.findAll(user, Page.Default)
    val summariesF  = pipelineService.listSummaries(user)

    for {
      sourcesPage    <- sourcesF
      typesPage      <- typesF
      dashboardsPage <- dashboardsF
      summaries      <- summariesF
      pipelines      <- Future.traverse(summaries)(buildPipeline(_, user))
      dataTypes      <- Future.traverse(typesPage.items)(toDataTypeEntry(_, user))
    } yield WorkspaceContextResponse(
      generatedAt = Instant.now().toString,
      counts = WorkspaceContextCounts(
        dataSources = sourcesPage.total,
        dataTypes   = typesPage.total,
        pipelines   = summaries.size,
        dashboards  = dashboardsPage.total
      ),
      dataSources = sourcesPage.items.map(toDataSourceEntry),
      dataTypes   = dataTypes,
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
   *  domain field (design.md D7), never through a wire round-trip.
   *
   *  HEL-372: fetches bounded `sampleRows` for a pipeline-output DataType
   *  only (design.md D2 — a source-companion DataType is never written to
   *  `data_type_rows`, so skipping the query entirely for `dt.sourceId.isDefined`
   *  avoids a guaranteed-empty round trip). `excludeKeys` strips Content-category
   *  (`string-body`/`binary-ref`, HEL-217) field values at the SQL tier before
   *  they ever reach the app (design.md D1); `sanitizeSampleRows` then applies
   *  the column/cell caps (design.md D3). A `listRows` failure (e.g. the
   *  DataType was deleted in the race between this `findAll` snapshot and this
   *  per-id call) degrades to `sampleRows = Vector.empty` rather than failing
   *  the whole assembly — mirrors `buildPipeline`'s per-entry degrade
   *  discipline (design.md D5 of the parent HEL-371 change). */
  private def toDataTypeEntry(dt: DataType, user: AuthenticatedUser): Future[WorkspaceContextDataType] = {
    val sampleRowsF: Future[Vector[JsObject]] =
      if (dt.sourceId.isDefined) Future.successful(Vector.empty)
      else {
        val excludeKeys = contentFieldNames(dt.fields)
        dataTypeService.listRows(dt.id, user, limit = Some(SampleRowLimit), excludeKeys = excludeKeys).map {
          case Right(rawRows) => sanitizeSampleRows(dt.fields, rawRows)
          case Left(_)         => Vector.empty
        }
      }

    sampleRowsF.map { sampleRows =>
      WorkspaceContextDataType(
        id             = dt.id.value,
        name           = dt.name,
        sourceId       = dt.sourceId.map(_.value),
        pipelineOutput = dt.sourceId.isEmpty,
        columns        = dt.fields.map(f => WorkspaceContextColumn(f.name, f.dataType, f.nullable)),
        computedColumns = dt.computedFields.map(cf => WorkspaceContextComputedColumn(cf.name, cf.dataType, cf.expression)),
        version        = dt.version,
        tag            = dt.tag,
        sampleRows     = sampleRows
      )
    }
  }

  private def contentFieldNames(fields: Vector[DataField]): Set[String] =
    fields.filter(f => fieldCategory(f) == FieldTypeCategory.Content).map(_.name).toSet

  /** A field whose `dataType` string doesn't parse via `DataFieldType.fromString`
   *  is conservatively excluded from both categories (never Structured, so
   *  never sampled) — design.md D3. */
  private def fieldCategory(f: DataField): Option[FieldTypeCategory] =
    DataFieldType.fromString(f.dataType).map(DataFieldType.category)

  /** Pure, unit-testable sanitizer (design.md D3, tasks.md 2.1/4.2):
   *   1. Column projection — keep only `Structured`-category fields (a field
   *      whose `dataType` doesn't parse is conservatively excluded), take the
   *      first `SampleColumnLimit` of those in `fields`' declared order.
   *   2. Row projection — the first `SampleRowLimit` rows (defense-in-depth;
   *      the SQL-tier `LIMIT` already bounds this in the real call path, but
   *      this keeps the function safe to call directly with an oversized
   *      `rawRows` in a unit test).
   *   3. Cell truncation — any retained cell whose `compactPrint.length > 200`
   *      is replaced with `JsString(compactPrint.take(200) + "…[truncated]")`,
   *      applied uniformly regardless of the value's original JSON type.
   *
   *  `private[services]` (not `private`) so `WorkspaceContextServiceSpec` can
   *  unit-test it directly without a DB fixture per case. */
  private[services] def sanitizeSampleRows(fields: Vector[DataField], rawRows: Vector[JsObject]): Vector[JsObject] = {
    val structuredFieldNames: Vector[String] =
      fields.filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured)).take(SampleColumnLimit).map(_.name)

    rawRows.take(SampleRowLimit).map { row =>
      val projected = structuredFieldNames.flatMap(name => row.fields.get(name).map(name -> truncateCell(_)))
      JsObject(projected.toMap)
    }
  }

  private def truncateCell(v: JsValue): JsValue = {
    val compact = v.compactPrint
    if (compact.length > SampleCellCharLimit)
      JsString(compact.take(SampleCellCharLimit) + TruncationMarker)
    else v
  }

  private def toDashboardEntry(d: Dashboard): WorkspaceContextDashboard =
    WorkspaceContextDashboard(id = d.id.value, name = d.name, panelCount = distinctPanelCount(d.layout))

  /** Distinct panel ids referenced across all four responsive breakpoints —
   *  mirrors `context.ts`'s `panelCount` helper. */
  private def distinctPanelCount(layout: DashboardLayout): Int =
    (layout.lg ++ layout.md ++ layout.sm ++ layout.xs).map(_.panelId).toSet.size
}
