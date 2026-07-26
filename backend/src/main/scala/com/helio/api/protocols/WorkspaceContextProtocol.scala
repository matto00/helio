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

final case class WorkspaceContextColumn(name: String, dataType: String, nullable: Boolean)
final case class WorkspaceContextComputedColumn(name: String, dataType: String, expression: String)

/** `pipelineOutput = sourceId.isEmpty` (design.md D7) — classified directly
 *  off the domain `DataType.sourceId: Option[DataSourceId]`, never through a
 *  wire round-trip (spray-json omits `None` fields, which is the exact
 *  footgun `context.ts`'s own inline comment documents for its client-side
 *  fan-out — the Scala assembler avoids it by construction). */
final case class WorkspaceContextDataType(
    id: String,
    name: String,
    sourceId: Option[String],
    pipelineOutput: Boolean,
    columns: Vector[WorkspaceContextColumn],
    computedColumns: Vector[WorkspaceContextComputedColumn],
    version: Int,
    tag: Option[String]
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
    dashboards: Vector[WorkspaceContextDashboard]
)

trait WorkspaceContextProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val workspaceContextCountsFormat: RootJsonFormat[WorkspaceContextCounts] =
    jsonFormat4(WorkspaceContextCounts.apply)
  implicit val workspaceContextDataSourceFormat: RootJsonFormat[WorkspaceContextDataSource] =
    jsonFormat4(WorkspaceContextDataSource.apply)
  implicit val workspaceContextColumnFormat: RootJsonFormat[WorkspaceContextColumn] =
    jsonFormat3(WorkspaceContextColumn.apply)
  implicit val workspaceContextComputedColumnFormat: RootJsonFormat[WorkspaceContextComputedColumn] =
    jsonFormat3(WorkspaceContextComputedColumn.apply)
  implicit val workspaceContextDataTypeFormat: RootJsonFormat[WorkspaceContextDataType] =
    jsonFormat8(WorkspaceContextDataType.apply)
  implicit val workspaceContextPipelineStepFormat: RootJsonFormat[WorkspaceContextPipelineStep] =
    jsonFormat4(WorkspaceContextPipelineStep.apply)
  implicit val workspaceContextPipelineFormat: RootJsonFormat[WorkspaceContextPipeline] =
    jsonFormat12(WorkspaceContextPipeline.apply)
  implicit val workspaceContextDashboardFormat: RootJsonFormat[WorkspaceContextDashboard] =
    jsonFormat3(WorkspaceContextDashboard.apply)
  implicit val workspaceContextResponseFormat: RootJsonFormat[WorkspaceContextResponse] =
    jsonFormat6(WorkspaceContextResponse.apply)
}
