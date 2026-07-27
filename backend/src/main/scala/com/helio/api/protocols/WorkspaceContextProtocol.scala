package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Workspace context assembler API types (HEL-371) ─────────────────────────
//
// Server-side port of `helio-mcp/src/context.ts`'s `WorkspaceContext` — see
// `schemas/workspace-context.schema.json` for the documented structural-parity
// delta (D4: no `pipelineShapes`) and the per-step field-set decision (this
// type carries the FULL per-step parity set — `position`/`type`/
// `outputColumns`/`validationError` — not just `outputColumns`, matching
// `context.ts`'s `steps` shape 1:1; see the schema description for the
// explicit call-out).

final case class WorkspaceContextCounts(
    dataSources: Int,
    dataTypes: Int,
    pipelines: Int,
    dashboards: Int
)

final case class WorkspaceContextDataSource(
    id: String,
    name: String,
    `type`: String,
    tag: Option[String]
)

/** `semanticRole` (HEL-374 design.md D1): one of `temporal`/`dimension`/`measure`/
 *  `identifier`/`boolean`/`text`, derived deterministically from the column's
 *  declared `dataType` + a name heuristic + (when available) `columnStats` —
 *  see `WorkspaceContextService.classifySemanticRole`. Advisory only: it never
 *  alters `dataType`, the authoritative declared type. */
final case class WorkspaceContextColumn(name: String, dataType: String, nullable: Boolean, semanticRole: String)
final case class WorkspaceContextComputedColumn(name: String, dataType: String, expression: String)

/** One inferred, advisory cross-DataType joinability hint (HEL-374 design.md
 *  D2): a bounded, precision-favoring pairwise comparison of `identifier`-role
 *  columns across the caller's own pipeline-output DataTypes, computed
 *  entirely from data `assemble` already fetched — no new DB access. Never
 *  authors a join step itself (HEL-342's concern). `confidence` is always in
 *  `[0.5, 1.0]`: `0.5` = name+type match with weak/no value or cardinality
 *  evidence; it approaches `1.0` only as sampled values overlap AND both
 *  columns show enough distinct values to make coincidental overlap unlikely
 *  — a cardinality-damped value-overlap boost (post-design-gate fix, design.md
 *  D2's `evidenceWeight`), not raw Jaccard overlap alone, so two unrelated
 *  low-cardinality identifier columns that coincidentally share the same
 *  small example-value set do NOT read as near-certain
 *  (`WorkspaceContextService.computeJoinHints`). A bounded heuristic over a
 *  small sample, never certainty — always advisory. The lexicographically
 *  smaller `dataTypeId` of the pair is always `left` — one hint per unordered
 *  pair, never two. */
final case class WorkspaceContextJoinHint(
    leftDataTypeId: String,
    leftColumn: String,
    rightDataTypeId: String,
    rightColumn: String,
    confidence: Double
)

/** Per-column statistics (HEL-373 `computeColumnStats`, design.md D4/D5/D6/D7):
 *  `nullRate`/`distinctCount`/`distinctCountCapped`/`exampleValues` are always
 *  present (design.md D7); `min`/`max`/`mean` are numeric-column-only and
 *  therefore `Option` — spray-json's `jsonFormatN` OMITS a `None` field from
 *  the wire rather than emitting `null`, so these three must NOT be listed in
 *  `ColumnStats`'s `required` array in `schemas/workspace-context.schema.json`
 *  (the exact lesson HEL-371 cost a full eval cycle on). */
final case class WorkspaceContextColumnStats(
    nullRate: Double,
    distinctCount: Int,
    distinctCountCapped: Boolean,
    exampleValues: Vector[JsValue],
    min: Option[Double],
    max: Option[Double],
    mean: Option[Double]
)

/** `pipelineOutput = sourceId.isEmpty` (design.md D7) — classified directly
 *  off the domain `DataType.sourceId: Option[DataSourceId]`, never through a
 *  wire round-trip (spray-json omits `None` fields, which is the exact
 *  footgun `context.ts`'s own inline comment documents for its client-side
 *  fan-out — the Scala assembler avoids it by construction).
 *
 *  `sampleRows` (HEL-372): up to 5 rows from the DataType's latest
 *  pipeline-run snapshot, capped to the first 40 declared Structured-category
 *  columns and 200 characters per cell (`WorkspaceContextService.sanitizeSampleRows`,
 *  design.md D3). Always present (an empty `Vector`, never `Option`) — a
 *  source-companion DataType or one with no run snapshot reports `[]`, so
 *  there is no spray-json `None`-omission concern here.
 *
 *  `columnStats` (HEL-373): one entry per Structured-category column (capped
 *  at 40, design.md D2), keyed by column name, computed from the same
 *  ≤500-row fetch `sampleRows` derives from. Always present (an empty `Map`,
 *  never `Option`) — same always-present convention as `sampleRows`. */
final case class WorkspaceContextDataType(
    id: String,
    name: String,
    sourceId: Option[String],
    pipelineOutput: Boolean,
    columns: Vector[WorkspaceContextColumn],
    computedColumns: Vector[WorkspaceContextComputedColumn],
    version: Int,
    tag: Option[String],
    sampleRows: Vector[JsObject],
    columnStats: Map[String, WorkspaceContextColumnStats]
)

final case class WorkspaceContextPipelineStep(
    position: Int,
    `type`: String,
    outputColumns: Vector[String],
    validationError: Option[String]
)

/** `steps`/`stepsError` mirror `context.ts`'s per-pipeline `try/catch` around
 *  `analyzePipeline` (design.md D5): a failed analyze degrades this single
 *  pipeline's entry to `steps: []` + `stepsError`, never fails the whole
 *  `GET /api/workspace/context` request. */
final case class WorkspaceContextPipeline(
    id: String,
    name: String,
    sourceDataSourceId: String,
    sourceDataSourceName: String,
    outputDataTypeId: String,
    outputDataTypeName: String,
    lastRunStatus: Option[String],
    lastRunAt: Option[String],
    lastRunRowCount: Option[Long],
    tag: Option[String],
    steps: Vector[WorkspaceContextPipelineStep],
    stepsError: Option[String]
)

final case class WorkspaceContextDashboard(id: String, name: String, panelCount: Int)

/** Top-level response for `GET /api/workspace/context`. Field-for-field
 *  structural parity with `helio-mcp/src/context.ts`'s `WorkspaceContext`
 *  EXCEPT `pipelineShapes`, intentionally omitted (design.md D4 — not part of
 *  this ticket's scope/acceptance criteria; `PipelineShapeService` is
 *  stateless/code-level with no RLS story). */
final case class WorkspaceContextResponse(
    generatedAt: String,
    counts: WorkspaceContextCounts,
    dataSources: Vector[WorkspaceContextDataSource],
    dataTypes: Vector[WorkspaceContextDataType],
    pipelines: Vector[WorkspaceContextPipeline],
    dashboards: Vector[WorkspaceContextDashboard],
    joinHints: Vector[WorkspaceContextJoinHint]
)

trait WorkspaceContextProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val workspaceContextCountsFormat: RootJsonFormat[WorkspaceContextCounts] =
    jsonFormat4(WorkspaceContextCounts.apply)
  implicit val workspaceContextDataSourceFormat: RootJsonFormat[WorkspaceContextDataSource] =
    jsonFormat4(WorkspaceContextDataSource.apply)
  implicit val workspaceContextColumnFormat: RootJsonFormat[WorkspaceContextColumn] =
    jsonFormat4(WorkspaceContextColumn.apply)
  implicit val workspaceContextComputedColumnFormat: RootJsonFormat[WorkspaceContextComputedColumn] =
    jsonFormat3(WorkspaceContextComputedColumn.apply)
  implicit val workspaceContextJoinHintFormat: RootJsonFormat[WorkspaceContextJoinHint] =
    jsonFormat5(WorkspaceContextJoinHint.apply)
  implicit val workspaceContextColumnStatsFormat: RootJsonFormat[WorkspaceContextColumnStats] =
    jsonFormat7(WorkspaceContextColumnStats.apply)
  // Map[String, WorkspaceContextColumnStats]'s format is summoned automatically
  // by spray-json's built-in `mapFormat[V: JsonFormat]` given the above
  // implicit — no separate named val needed.
  implicit val workspaceContextDataTypeFormat: RootJsonFormat[WorkspaceContextDataType] =
    jsonFormat10(WorkspaceContextDataType.apply)
  implicit val workspaceContextPipelineStepFormat: RootJsonFormat[WorkspaceContextPipelineStep] =
    jsonFormat4(WorkspaceContextPipelineStep.apply)
  implicit val workspaceContextPipelineFormat: RootJsonFormat[WorkspaceContextPipeline] =
    jsonFormat12(WorkspaceContextPipeline.apply)
  implicit val workspaceContextDashboardFormat: RootJsonFormat[WorkspaceContextDashboard] =
    jsonFormat3(WorkspaceContextDashboard.apply)
  implicit val workspaceContextResponseFormat: RootJsonFormat[WorkspaceContextResponse] =
    jsonFormat7(WorkspaceContextResponse.apply)
}
