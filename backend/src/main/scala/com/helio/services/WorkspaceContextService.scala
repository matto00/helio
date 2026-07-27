package com.helio.services

import com.helio.api.protocols.{
  AnalyzeStepResponse,
  PipelineSummaryResponse,
  WorkspaceContextColumn,
  WorkspaceContextColumnStats,
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
import spray.json.{JsNull, JsNumber, JsObject, JsString, JsValue}

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.math.BigDecimal.RoundingMode

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
   *  enforces this at the SQL tier via `LIMIT`. `sampleRows` is derived from
   *  the first `SampleRowLimit` of the shared `StatsRowLimit`-wide fetch
   *  below (HEL-373 design.md D1) — its own wire output is unchanged. */
  private val SampleRowLimit: Int = 5

  /** Shared fetch's row bound (HEL-373 design.md D1): raised from
   *  `SampleRowLimit` (5) to 500 — matches `DataSourceService.staticMaxRows`,
   *  the codebase's existing "reasonably-sized snapshot" constant. Both
   *  `sampleRows` and `columnStats` are derived from this ONE fetch; no
   *  second query. */
  private val StatsRowLimit: Int = 500

  /** First N declared Structured-category columns retained per sample row
   *  and per `columnStats` (design.md D3/D2 round-3 fix) — enforced BOTH at
   *  the SQL tier (`excludeKeys` extension below) and independently by
   *  `computeColumnStats`'s own column enumeration (design.md D2). */
  private val SampleColumnLimit: Int = 40

  /** Per-cell character cap before truncation (design.md D3). */
  private val SampleCellCharLimit: Int = 200

  private val TruncationMarker: String = "…[truncated]"

  /** `distinctCount` stops distinguishing beyond this cap (design.md D4);
   *  `distinctCountCapped: true` reports "at least this many, exact count not
   *  computed beyond the cap." */
  private val DistinctCountCap: Int = 100

  /** Max `exampleValues` entries per column (design.md D6). */
  private val ExampleValueLimit: Int = 5

  /** `mean`'s fixed rounding precision — 4 decimal places (design.md D5/D6
   *  determinism). Round-3 fix: applied via `BigDecimal.setScale`, not a
   *  multiply-by-`10^scale`-then-`math.round` factor (see
   *  `computeColumnStatsForField`'s round-3-fix comment for why the latter
   *  technique is itself an overflow surface). */
  private val MeanRoundingScale: Int = 4

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
    // HEL-373 design.md D1: ONE shared fetch (limit = StatsRowLimit, 500)
    // serves both sampleRows and columnStats — no second query path.
    // excludeKeys is the union of Content-category field names (unchanged
    // from HEL-372) and the Structured-category column-count overflow beyond
    // SampleColumnLimit (design.md D1 round-1 fix) — Postgres itself never
    // returns more than 40 Structured columns per row.
    val statsF: Future[(Vector[JsObject], Map[String, WorkspaceContextColumnStats])] =
      if (dt.sourceId.isDefined) Future.successful((Vector.empty, Map.empty))
      else {
        val excludeKeys = contentFieldNames(dt.fields) ++
          DataTypeService.overflowStructuredFieldNames(dt.fields, SampleColumnLimit)
        dataTypeService.listRows(dt.id, user, limit = Some(StatsRowLimit), excludeKeys = excludeKeys).map {
          // Both outputs derived from `rawRows` in this SAME step, so `rawRows`
          // goes out of scope here — never retained beyond this map (design.md
          // D1a's binding memory-retention requirement).
          case Right(rawRows) => (sanitizeSampleRows(dt.fields, rawRows), computeColumnStats(dt.fields, rawRows))
          case Left(_)        => (Vector.empty, Map.empty)
        }
      }

    statsF.map { case (sampleRows, columnStats) =>
      WorkspaceContextDataType(
        id             = dt.id.value,
        name           = dt.name,
        sourceId       = dt.sourceId.map(_.value),
        pipelineOutput = dt.sourceId.isEmpty,
        columns        = dt.fields.map(f => WorkspaceContextColumn(f.name, f.dataType, f.nullable)),
        computedColumns = dt.computedFields.map(cf => WorkspaceContextComputedColumn(cf.name, cf.dataType, cf.expression)),
        version        = dt.version,
        tag            = dt.tag,
        sampleRows     = sampleRows,
        columnStats    = columnStats
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

  /** Per-column fold accumulator for `computeColumnStats` — not part of the
   *  wire shape, purely an internal aggregation helper. `distinctSeen` is
   *  unordered and capped at `DistinctCountCap + 1` (101) entries (design.md
   *  D4 — order doesn't matter for a count); `exampleValues`/`exampleKeysSeen`
   *  are the order-preserving, separately-capped-at-5 sibling (design.md D6).
   */
  private final case class ColumnFold(
      nullCount: Int = 0,
      distinctSeen: Set[String] = Set.empty,
      exampleValues: Vector[JsValue] = Vector.empty,
      exampleKeysSeen: Set[String] = Set.empty,
      numericCount: Int = 0,
      numericSum: Double = 0.0,
      numericMin: Double = Double.PositiveInfinity,
      numericMax: Double = Double.NegativeInfinity
  )

  /** `computeColumnStats`'s direct sibling to `sanitizeSampleRows` (design.md
   *  D1/D2/D3/D4/D5/D6/D8, tasks.md 3.1). **Column enumeration**: filters
   *  `fields` to Structured-category and takes the first `SampleColumnLimit`
   *  (40) in declared order — REQUIRED and independent of the SQL-tier
   *  `excludeKeys` bound applied to the fetch itself (design.md D2 round-3
   *  fix: the SQL-tier bound only stops Postgres from sending overflow-column
   *  *values*; it does nothing to stop this enumeration from still producing
   *  an entry per overflow column name if not filtered here too).
   *
   *  Produces one entry per (capped) Structured-category column even when
   *  `rawRows` is empty (design.md D8) — `nullRate: 0` (not `NaN`),
   *  `distinctCount: 0`, `distinctCountCapped: false`, `exampleValues: []`,
   *  no `min`/`max`/`mean` in that case.
   *
   *  `private[services]` (not `private`) so `WorkspaceContextServiceSpec` can
   *  unit-test it directly without a DB fixture per case, mirroring
   *  `sanitizeSampleRows`. */
  private[services] def computeColumnStats(
      fields: Vector[DataField],
      rawRows: Vector[JsObject]
  ): Map[String, WorkspaceContextColumnStats] = {
    val structuredFields: Vector[DataField] =
      fields.filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured)).take(SampleColumnLimit)

    structuredFields.map(field => field.name -> computeColumnStatsForField(field, rawRows)).toMap
  }

  private def computeColumnStatsForField(field: DataField, rawRows: Vector[JsObject]): WorkspaceContextColumnStats = {
    val isNumericField = DataFieldType.fromString(field.dataType) match {
      case Some(DataFieldType.IntegerType) | Some(DataFieldType.FloatType) => true
      case _                                                               => false
    }
    val totalRows = rawRows.size

    val fold = rawRows.foldLeft(ColumnFold()) { (acc, row) =>
      row.fields.get(field.name) match {
        case None | Some(JsNull) =>
          acc.copy(nullCount = acc.nullCount + 1)
        case Some(v) =>
          val truncated    = truncateCell(v)
          val truncatedKey = truncated.compactPrint

          // Distinct-count set: stops growing once already past the cap
          // (design.md D4 — never allowed past 101 entries).
          val withDistinct =
            if (acc.distinctSeen.size > DistinctCountCap || acc.distinctSeen.contains(truncatedKey)) acc
            else acc.copy(distinctSeen = acc.distinctSeen + truncatedKey)

          // Example values: first 5 distinct, truncated, non-null values in
          // row order (design.md D6 determinism).
          val withExamples =
            if (withDistinct.exampleValues.size >= ExampleValueLimit || withDistinct.exampleKeysSeen.contains(truncatedKey))
              withDistinct
            else
              withDistinct.copy(
                exampleValues   = withDistinct.exampleValues :+ truncated,
                exampleKeysSeen = withDistinct.exampleKeysSeen + truncatedKey
              )

          if (isNumericField)
            asNumeric(v) match {
              case Some(n) =>
                withExamples.copy(
                  numericCount = withExamples.numericCount + 1,
                  numericSum   = withExamples.numericSum + n,
                  numericMin   = math.min(withExamples.numericMin, n),
                  numericMax   = math.max(withExamples.numericMax, n)
                )
              case None => withExamples
            }
          else withExamples
      }
    }

    val distinctCountCapped = fold.distinctSeen.size > DistinctCountCap
    val distinctCount       = math.min(fold.distinctSeen.size, DistinctCountCap)
    val nullRate            = if (totalRows == 0) 0.0 else fold.nullCount.toDouble / totalRows

    // `rawMean` is deliberately left UNROUNDED here — see the rounding
    // technique note below for why.
    val (min, max, rawMean) =
      if (fold.numericCount > 0)
        (Some(fold.numericMin), Some(fold.numericMax), Some(fold.numericSum / fold.numericCount))
      else (None, None, None)

    // HEL-373 skeptic-final-3.md, human-mandated placement: the terminal
    // boundary before a WorkspaceContextColumnStats is built and serialized —
    // the ONE place a "no non-finite min/max/mean" invariant can be enforced
    // totally, regardless of whether the non-finite value originated from a
    // per-value parse (asNumeric, already airtight per rounds 1-2) or from
    // aggregation itself (e.g. `fold.numericSum` overflowing Double to
    // Infinity across many individually-finite values, round 3's finding —
    // `min`/`max` cannot overflow the same way since they're `math.min`/
    // `math.max` over already-finite operands, but are guarded here too so
    // the invariant covers all three fields uniformly rather than depending
    // on today's arithmetic happening not to overflow). INVARIANT: no
    // WorkspaceContextColumnStats may ever be constructed containing a
    // non-finite min/max/mean — a non-finite value is excluded (`None`), same
    // "excluded, not fabricated, not zero" semantics asNumeric already
    // established for individual values.
    //
    // Rounding technique (round-3 fix, replaces design.md D5's originally
    // literal `math.round(sum/count * 10000) / 10000.0`): that technique's
    // OWN multiply-by-10000 step is a second, independent overflow surface —
    // `math.round` on a Double **at or beyond `Long.MaxValue` in magnitude**
    // (not just actual `Infinity`) silently CLAMPS to `Long.MaxValue` rather
    // than erroring (confirmed by direct probe: `math.round(1e308)` ==
    // `Long.MaxValue`), so a genuinely large-but-finite mean (e.g. one
    // enormous-but-legitimate outlier value averaged with 499 ordinary rows)
    // would silently fabricate the identical wrong ~922-trillion value this
    // whole ticket has been about eliminating — even though `rawMean` itself
    // is finite and mathematically correct. `BigDecimal.setScale` avoids this
    // entirely: it rounds to 4 decimal places without ever multiplying the
    // value's own magnitude, so a legitimately huge finite mean survives
    // correctly (its 4-decimals-place rounding is a practical no-op at that
    // magnitude, which is expected — not a defect). The final `.isFinite`
    // check (defense in depth) still excludes the vanishingly rare case where
    // `.toDouble`'s own BigDecimal→Double conversion overflows.
    WorkspaceContextColumnStats(
      nullRate             = nullRate,
      distinctCount        = distinctCount,
      distinctCountCapped  = distinctCountCapped,
      exampleValues        = fold.exampleValues,
      min                  = min.filter(_.isFinite),
      max                  = max.filter(_.isFinite),
      mean                 = rawMean.filter(_.isFinite).map(roundToFourDecimals).filter(_.isFinite)
    )
  }

  /** Rounds `v` to 4 decimal places via `BigDecimal.setScale` (design.md D5's
   *  "4 decimal places" requirement) without the intermediate
   *  multiply-then-`math.round`-as-`Long` overflow surface — see the
   *  round-3-fix comment at `computeColumnStatsForField`'s call site. Callers
   *  are responsible for ensuring `v` is already finite (this function does
   *  not itself guard non-finite input — `BigDecimal(Double.PositiveInfinity)`
   *  throws, so callers must filter first, which `computeColumnStatsForField`
   *  already does). */
  private def roundToFourDecimals(v: Double): Double =
    BigDecimal(v).setScale(MeanRoundingScale, RoundingMode.HALF_UP).toDouble

  /** Numeric parsing (design.md D5): `JsNumber` directly; `JsString(s)` via
   *  `s.trim.toDoubleOption` (CSV sources read numeric-declared columns as
   *  strings at runtime); everything else (boolean/object/array/unparseable
   *  string) is `None` — excluded from `min`/`max`/`mean`, NOT counted as
   *  null, NOT treated as `0`.
   *
   *  **Single exit-point finiteness filter (HEL-373 skeptic-final-2.md,
   *  human-mandated restructure after skeptic-final-1.md's per-branch patch
   *  missed a sibling instance of the same bug)**: `.filter(_.isFinite)` is
   *  applied ONCE, to the whole match's result, not per-branch. Why: a
   *  large-magnitude numeric JSON literal can overflow to `±Infinity` on
   *  conversion to `Double` regardless of which branch produced the
   *  candidate — `JsNumber`'s `BigDecimal.toDouble` overflows for a
   *  sufficiently large magnitude (e.g. `1e400`) even though `BigDecimal`
   *  itself is always finite/arbitrary-precision, and `JsString`'s
   *  `toDoubleOption` accepts the literal strings `"NaN"`/`"Infinity"`/
   *  `"-Infinity"` as successfully-parsed non-finite doubles. Either path
   *  would otherwise poison `mean` via `math.round` (`NaN` → `0L`,
   *  `Infinity` → `Long.MaxValue`) and make `min`/`max` silently
   *  wire-serialize to `null` via a `Some(NaN)`/`Some(Infinity)` — a
   *  different, unhandled failure mode from the documented `None`-omission
   *  behavior. Filtering once at the exit makes the function structurally
   *  incapable of returning a non-finite value regardless of which branch
   *  produced it, and any future branch added here inherits the guarantee
   *  automatically — the fix is at the contract's boundary, not duplicated
   *  per-branch.
   *
   *  `private[services]` so `WorkspaceContextServiceSpec` can unit-test it
   *  directly. */
  private[services] def asNumeric(v: JsValue): Option[Double] = (v match {
    case JsNumber(n) => Some(n.toDouble)
    case JsString(s) => s.trim.toDoubleOption
    case _           => None
  }).filter(_.isFinite)

  private def toDashboardEntry(d: Dashboard): WorkspaceContextDashboard =
    WorkspaceContextDashboard(id = d.id.value, name = d.name, panelCount = distinctPanelCount(d.layout))

  /** Distinct panel ids referenced across all four responsive breakpoints —
   *  mirrors `context.ts`'s `panelCount` helper. */
  private def distinctPanelCount(layout: DashboardLayout): Int =
    (layout.lg ++ layout.md ++ layout.sm ++ layout.xs).map(_.panelId).toSet.size
}
