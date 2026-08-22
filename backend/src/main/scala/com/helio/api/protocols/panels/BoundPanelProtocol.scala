package com.helio.api.protocols.panels

import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineProtocol}
import com.helio.api.protocols.sources.{DataSourceProtocol, StaticColumnPayload}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Compound bound-panel API types (HEL-364) ─────────────────────────────────
//
// `POST /api/panels/bound` — one call composing source (create-or-reuse) →
// pipeline+steps → synchronous run → panel create+bind. See
// `com.helio.services.BoundPanelService` for the orchestration and
// design.md's D2 for the wire-shape rationale.

/** Inline static source spec — `{name, columns, rows}`, the same shape
 *  `StaticDataSourceRequest` already carries (minus the `type` discriminator,
 *  which is implied: inline `source` always creates a `static` DataSource —
 *  CSV/URL sources are out of scope for this compound op, design.md D4).
 *
 *  `rows` is pinned to the existing positional array-of-arrays convention
 *  (`Vector[Vector[JsValue]]`, one value per `columns` entry in order) —
 *  matching `StaticDataSourceRequest.rows` and the MCP's existing
 *  `createDataSource({..., rows: unknown[][]})` — not a row-object shape. */
final case class BoundSourceSpec(
    name: String,
    columns: Vector[StaticColumnPayload],
    rows: Vector[Vector[JsValue]]
)

/** Pipeline spec — `name` is optional (a default is derived server-side from
 *  `outputDataTypeName` when absent); `steps` reuses the exact
 *  `CreatePipelineStepRequest` shape `POST /api/pipelines/:id/steps` already
 *  accepts, applied in order via `PipelineService.addStep`. */
final case class BoundPipelineSpec(
    name: Option[String],
    outputDataTypeName: String,
    steps: Vector[CreatePipelineStepRequest]
)

/** Panel spec — mirrors `CreatePanelRequest` minus `dashboardId` (carried at
 *  the top level of [[BoundPanelRequest]]) and minus a binding
 *  (`dataTypeId`/`fieldMapping`): the server injects those into `config` once
 *  the pipeline's output DataType exists (design.md D2). `type` MUST be one
 *  of the data-bindable panel kinds (`PanelBindingSpec.DataBindable`) —
 *  anything else is rejected before any write (design.md D3). */
final case class BoundPanelSpec(
    `type`: String,
    title: String,
    config: Option[JsValue],
    appearance: Option[PanelAppearancePayload]
)

/** `POST /api/panels/bound` request — exactly one of `source` (inline) or
 *  `sourceDataSourceId` (an existing, caller-owned DataSource) must be
 *  present. `fieldMapping` is the top-level binding merged into
 *  `panel.config.fieldMapping` alongside the server-injected `dataTypeId`. */
final case class BoundPanelRequest(
    dashboardId: String,
    source: Option[BoundSourceSpec],
    sourceDataSourceId: Option[String],
    pipeline: BoundPipelineSpec,
    panel: BoundPanelSpec,
    fieldMapping: Option[JsObject]
)

/** `POST /api/panels/bound` response — every id created (or reused) by this
 *  call, plus the created, already-bound panel (rows already present —
 *  the pipeline run is synchronous). */
final case class BoundPanelResponse(
    sourceId: String,
    pipelineId: String,
    dataTypeId: String,
    panel: PanelResponse
)

/** `BoundPanelProtocol` needs `PanelProtocol` (PanelResponse,
 *  PanelAppearancePayload), `DataSourceProtocol` (StaticColumnPayload), and
 *  `PipelineProtocol` (CreatePipelineStepRequest, via PipelineStepProtocol)
 *  formats in scope for its `jsonFormatN` macros — a passive structural
 *  dependency on all three, mirroring how `DashboardProtocol`/`DataSourceProtocol`
 *  each extend exactly the domain trait(s) their own case classes reference. */
trait BoundPanelProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with PanelProtocol
    with DataSourceProtocol
    with PipelineProtocol {

  implicit val boundSourceSpecFormat: RootJsonFormat[BoundSourceSpec]     = jsonFormat3(BoundSourceSpec.apply)
  implicit val boundPipelineSpecFormat: RootJsonFormat[BoundPipelineSpec] = jsonFormat3(BoundPipelineSpec.apply)
  implicit val boundPanelSpecFormat: RootJsonFormat[BoundPanelSpec]       = jsonFormat4(BoundPanelSpec.apply)
  implicit val boundPanelRequestFormat: RootJsonFormat[BoundPanelRequest] = jsonFormat6(BoundPanelRequest.apply)
  implicit val boundPanelResponseFormat: RootJsonFormat[BoundPanelResponse] = jsonFormat4(BoundPanelResponse.apply)
}
