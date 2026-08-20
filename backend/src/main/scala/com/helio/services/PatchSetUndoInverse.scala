package com.helio.services

import com.helio.api.protocols.{
  CreatePanelRequest,
  CreatePipelineStepRequest,
  DashboardAppearancePayload,
  DashboardLayoutItemPayload,
  DashboardLayoutItemResponse,
  DashboardLayoutPayload,
  DashboardResponse,
  ComputedFieldPayload,
  DataFieldPayload,
  DataTypeResponse,
  PanelAppearancePayload,
  PanelAppearanceResponse,
  PanelResponse,
  UpdateDataTypeRequest,
  UpdateDashboardRequest,
  UpdatePanelRequest,
  UpdatePipelineStepRequest
}
import com.helio.domain.panels._
import PatchSetApplyServiceJson._
import spray.json.{JsNull, JsNumber, JsObject, JsString, JsValue}

/** Full-overwrite inverse-request builders FROM the persisted, decoded RESPONSE-shaped JSON
 *  (`PanelResponse`/`DashboardResponse`/`DataTypeResponse`/raw `PipelineStepResponse` JSON) that
 *  survives in `PatchSetApplicationRepository`'s journal — NOT a literal reuse of
 *  `PatchSetApplyRollback`'s private inverse-builders, which take domain objects (`Panel`,
 *  `Dashboard`, ...) that exist only for the duration of one apply call (design.md D5).
 *
 *  Mirrors `PatchSetApplyRollback`'s field-for-field mapping exactly, including
 *  `fullConfigInverse`'s explicit-null-default treatment for omitted Option config fields —
 *  the exact HEL-406 final-gate bug (`optionalConfigFieldNames`), independently re-verified here
 *  by `PatchSetUndoInverseSpec` (tasks.md 5.2). `dataSourceId`/`pipelineId`'s own one-field
 *  inverses (`UpdateDataSourceRequest(name = ...)`/`UpdatePipelineRequest(name = ...)`) are
 *  trivial enough that, mirroring `PatchSetApplyRollback`'s own choice, they stay inlined at
 *  `PatchSetUndoService`'s call site rather than getting a dedicated builder here. */
private[services] object PatchSetUndoInverse {

  // ── panel ────────────────────────────────────────────────────────────────

  private def fullPanelAppearancePatch(appearance: PanelAppearanceResponse): JsValue =
    JsObject(
      "background"   -> JsString(appearance.background),
      "color"        -> JsString(appearance.color),
      "transparency" -> JsNumber(appearance.transparency),
      // Explicit `chart: null` (not an omitted key) when the captured panel had no chart
      // appearance -- mirrors `PatchSetApplyRollback.fullPanelAppearancePatch`'s identical guard.
      "chart" -> appearance.chart.map(chartAppearanceFormat.write).getOrElse(JsNull)
    )

  /** Per-kind set of Option-typed config field names each kind's own `*Config.Patch.decode`/
   *  `applyPatch` actually reads — an INDEPENDENT reimplementation of
   *  `PatchSetApplyRollback.optionalConfigFieldNames`, not a shared reference to it (design.md
   *  D5: "New inverse-builders, not literal reuse"). Kept in exact sync deliberately;
   *  `PatchSetUndoInverseSpec` (tasks.md 5.2) is the regression test guarding against the two
   *  implementations drifting apart the way HEL-406's own final gate caught once already. */
  private def optionalConfigFieldNames(kind: String): Set[String] = kind match {
    case MetricPanel.Kind     => Set("aggregation", "label", "unit", "metricId")
    case ChartPanel.Kind      => Set("aggregation", "chartOptions", "annotation", "metricId")
    case TablePanel.Kind      => Set("density", "columnOrder", "metricId")
    case ImagePanel.Kind      => Set("caption")
    case DividerPanel.Kind    => Set("weight", "color")
    case CollectionPanel.Kind => Set("itemOptions")
    case _                    => Set.empty
  }

  /** design.md D5's "every field populated" full-overwrite contract, applied to `config`.
   *  `PanelConfigCodec.encodeConfig`'s plain-`jsonFormatN` writer OMITS a `None`-valued Option
   *  config field entirely rather than writing `null` (the SAME behavior the persisted
   *  `PanelResponse.config` JSON exhibits, since it's built the exact same way); every
   *  `*Config.Patch.decode` + `applyPatch` then treats an ABSENT key as "leave the CURRENT
   *  (post-forward-edit) value unchanged" -- so an inverse built from the bare config JSON could
   *  never actually clear an Option field the original edit had set. Supplying an explicit `null`
   *  default for every Option-typed field this kind's Patch reader recognizes -- overridden by
   *  `configJson`'s real value wherever the captured state actually had one set -- closes that
   *  gap. */
  private def fullConfigInverse(configJson: JsValue, kind: String): JsValue = {
    val nullDefaults = optionalConfigFieldNames(kind).map(_ -> JsNull).toMap
    JsObject(nullDefaults ++ configJson.asJsObject.fields)
  }

  def fullPanelInverse(response: PanelResponse): UpdatePanelRequest =
    UpdatePanelRequest(
      title      = Some(response.title),
      appearance = Some(fullPanelAppearancePatch(response.appearance)),
      `type`     = None,
      config     = Some(fullConfigInverse(response.config, response.`type`))
    )

  private def panelAppearancePayloadFromResponse(appearance: PanelAppearanceResponse): PanelAppearancePayload =
    PanelAppearancePayload(
      background   = Some(appearance.background),
      color        = Some(appearance.color),
      transparency = Some(appearance.transparency),
      chart        = appearance.chart
    )

  /** A `panel` `delete` edit's undo recreates under a NEW id (design.md D5, inherited unchanged
   *  from `PatchSetApplyRollback`'s own D3a v1 limit) -- `response.config` is already the raw,
   *  unmaterialized shape (the captured `priorState` for a delete edit comes from an
   *  unmaterialized `findByIdInternal` read, same as every other panel `priorState`). */
  def panelCreateRequestFromResponse(response: PanelResponse): CreatePanelRequest =
    CreatePanelRequest(
      dashboardId = Some(response.dashboardId),
      title       = Some(response.title),
      `type`      = Some(response.`type`),
      config      = Some(response.config),
      appearance  = Some(panelAppearancePayloadFromResponse(response.appearance))
    )

  // ── dashboard ────────────────────────────────────────────────────────────

  def fullDashboardInverse(response: DashboardResponse): UpdateDashboardRequest = {
    def layoutItems(items: Vector[DashboardLayoutItemResponse]): Vector[DashboardLayoutItemPayload] =
      items.map(i => DashboardLayoutItemPayload(i.panelId, i.x, i.y, i.w, i.h))
    UpdateDashboardRequest(
      name       = Some(response.name),
      appearance = Some(DashboardAppearancePayload(Some(response.appearance.background), Some(response.appearance.gridBackground))),
      layout = Some(DashboardLayoutPayload(
        lg = layoutItems(response.layout.lg),
        md = layoutItems(response.layout.md),
        sm = layoutItems(response.layout.sm),
        xs = layoutItems(response.layout.xs)
      ))
    )
  }

  // ── dataType ─────────────────────────────────────────────────────────────

  def fullDataTypeInverse(response: DataTypeResponse): UpdateDataTypeRequest =
    UpdateDataTypeRequest(
      name           = Some(response.name),
      fields         = Some(response.fields.map(f => DataFieldPayload(f.name, f.displayName, f.dataType, f.nullable))),
      computedFields = Some(response.computedFields.map(cf => ComputedFieldPayload(cf.name, cf.displayName, cf.expression, cf.dataType)))
    )

  // ── pipelineStep ─────────────────────────────────────────────────────────
  //
  // Unlike the five kinds above, `PipelineStepResponse` is a 22-subtype sealed union whose
  // typed `config` field isn't exposed on the common trait -- decoding into it would only force
  // a matching 22-arm dispatch to get back the very `type`/`config`/`position` fields already
  // sitting, untyped, at the top level of the persisted wire JSON
  // (`pipelineStepResponseFormat.write`'s own shape: `{...subtype fields incl. "config" nested,
  // "type": "..."}`). Reading those three fields directly off the raw `JsValue` is simpler and
  // exactly as sound -- this is the same untyped-JsValue-passthrough discipline `EditOutcome`'s
  // own `priorState`/`resultingState` already use everywhere else in this file family.

  def fullPipelineStepInverse(json: JsValue): UpdatePipelineStepRequest = {
    val fields = json.asJsObject.fields
    UpdatePipelineStepRequest(
      `type`   = fields.get("type").map(_.convertTo[String]),
      config   = fields.get("config").map(_.asJsObject),
      position = fields.get("position").map(_.convertTo[Int]),
      // Full-overwrite inverse (design.md D6) -- always `Some(...)`, never left `None` ("no
      // change") like the ordinary PATCH contract, else a since-toggled LIVE step would survive
      // the revert with its own current `enabled` value. Absent key (legacy JSON predating
      // HEL-412) defaults to `true`, matching the create request's own absent-means-true contract.
      enabled = Some(fields.get("enabled").map(_.convertTo[Boolean]).getOrElse(true))
    )
  }

  def pipelineStepCreateRequestFromResponse(json: JsValue): CreatePipelineStepRequest = {
    val fields = json.asJsObject.fields
    CreatePipelineStepRequest(
      `type` = fields("type").convertTo[String],
      config = fields("config").asJsObject,
      // `None` already means "created enabled" (design.md D7) -- matches the create endpoint's
      // own absent-means-true default, so no explicit default is restated here.
      enabled = fields.get("enabled").map(_.convertTo[Boolean])
    )
  }
}
