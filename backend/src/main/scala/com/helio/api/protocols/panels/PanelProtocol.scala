package com.helio.api.protocols.panels

import com.helio.api.protocols.ResourceProtocol
import com.helio.api.protocols.ResourceMetaResponse
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import com.helio.domain.panels._
import spray.json._


final case class PanelAppearancePayload(
    background: Option[String],
    color: Option[String],
    transparency: Option[Double],
    chart: Option[ChartAppearance]
)
final case class PanelAppearanceResponse(
    background: String,
    color: String,
    transparency: Double,
    chart: Option[ChartAppearance]
)

/** `{x, y, w, h}` — the grid position/size a panel was just placed at.
 *  Populated only by `POST /api/panels` (decision-15 server-owned default
 *  size, HEL-909 CR1); every other `PanelResponse` producer passes `None`
 *  since layout is otherwise a dashboard-owned field
 *  (`dashboards.layout`), not re-echoed per panel. */
final case class PanelLayoutResponse(x: Int, y: Int, w: Int, h: Int)

/** CS2c-3c discriminated wire shape: every panel response carries a `type`
 *  discriminator and a typed `config` payload whose shape is determined by
 *  the discriminator. Per-subtype flat nullable fields at the response root
 *  are gone — readers narrow on `type` and read fields from `config`.
 *
 *  `dataAsOf` (HEL-234): retained on the wire shape for backward
 *  compatibility, but HEL-904 task 4.1 removed its only producer
 *  (`PipelineRepository.findLastRunAtByOutputDataTypeId`'s caller) — every
 *  caller of `fromDomain` now passes `None` (→ JSON `null`). */
final case class PanelResponse(
    id: String,
    dashboardId: String,
    title: String,
    `type`: String,
    meta: ResourceMetaResponse,
    appearance: PanelAppearanceResponse,
    ownerId: String,
    config: JsValue,
    dataAsOf: Option[String],
    layout: Option[PanelLayoutResponse] = None
)
final case class PanelsResponse(items: Vector[PanelResponse])

/** Create request — `{ dashboardId, title?, type, config, appearance? }`.
 *  `config` is a typed JSON object whose shape is determined by `type`; the
 *  per-subtype decoder under `domain/panels` resolves it (tolerant of `{}`).
 *
 *  `appearance` (HEL-305) is an optional creation-time appearance with the same
 *  wire shape as the PATCH appearance (`PanelAppearancePayload`). When present
 *  it is normalized + `chartType`-validated and stored on the created panel in
 *  place of `PanelAppearance.Default`; when absent the default is applied
 *  exactly as before. Additive and non-breaking. */
final case class CreatePanelRequest(
    dashboardId: Option[String],
    title: Option[String],
    `type`: Option[String],
    config: Option[JsValue],
    appearance: Option[PanelAppearancePayload] = None
)

/** Update request — `{ title?, appearance?, type?, config? }`. `config`
 *  (when present) carries a typed patch whose shape matches the request's
 *  `type` (and at the service layer, the stored panel's type — cross-type
 *  PATCH is rejected with 400). Within `config`, fields use absent-vs-null
 *  semantics per the per-subtype `Patch.decode`.
 *
 *  `appearance` (HEL-362) is a raw `JsValue` passthrough — mirroring `config`
 *  — so the service layer can decode it against the stored panel's appearance
 *  with full absent-vs-null merge semantics via `PanelAppearance.applyPatchJson`. */
final case class UpdatePanelRequest(
    title: Option[String],
    appearance: Option[JsValue],
    `type`: Option[String],
    config: Option[JsValue]
)

/** Batch entry mirrors the single-update shape. */
final case class PanelBatchItem(
    id: String,
    title: Option[String],
    appearance: Option[JsValue],
    `type`: Option[String],
    config: Option[JsValue]
)
final case class UpdatePanelsBatchRequest(fields: Vector[String], panels: Vector[PanelBatchItem])
final case class UpdatePanelsBatchResponse(panels: Vector[PanelResponse])

/** Batch-create entry (HEL-370) — `CreatePanelRequest` minus `dashboardId`,
 *  which is lifted to the envelope (`CreatePanelsBatchRequest`) since every
 *  item in one batch targets the same dashboard (design.md D3). */
final case class CreatePanelBatchItem(
    title: Option[String],
    `type`: Option[String],
    config: Option[JsValue],
    appearance: Option[PanelAppearancePayload] = None
)
final case class CreatePanelsBatchRequest(dashboardId: Option[String], panels: Vector[CreatePanelBatchItem])
final case class CreatePanelsBatchResponse(panels: Vector[PanelResponse])

object PanelResponse {

  /** Build a discriminated-wire response from the typed `Panel` ADT.
   *
   *  CS2c-3c collapses the prior wide-flat shape (8 nullable subtype fields
   *  at the root) to `type` + typed `config`. Per-subtype `*Config` already
   *  carries a `RootJsonFormat`; this dispatcher selects it and emits the
   *  config payload as the `config` field.
   *
   *  `dataAsOf` (HEL-234): every call site now passes `None` (see the class
   *  doc comment above). */
  def fromDomain(
      panel: Panel,
      dataAsOf: Option[String] = None,
      layout: Option[PanelLayoutResponse] = None
  ): PanelResponse =
    PanelResponse(
      id          = panel.id.value,
      dashboardId = panel.dashboardId.value,
      title       = panel.title,
      `type`      = panel.kind,
      meta        = ResourceMetaResponse.fromDomain(panel.meta),
      appearance  = PanelAppearanceResponse.fromDomain(panel.appearance),
      ownerId     = panel.ownerId.value,
      config      = PanelConfigCodec.encodeConfig(panel),
      dataAsOf    = dataAsOf,
      layout      = layout
    )
}

object PanelAppearanceResponse {
  def fromDomain(appearance: PanelAppearance): PanelAppearanceResponse =
    PanelAppearanceResponse(
      background   = appearance.background,
      color        = appearance.color,
      transparency = appearance.transparency,
      chart        = appearance.chart
    )
}

/** `PanelProtocol extends ResourceProtocol` because `PanelResponse` carries a
 *  `ResourceMetaResponse` (and thus `panelResponseFormat`'s `jsonFormatN`
 *  macro needs `resourceMetaResponseFormat` in implicit scope at definition
 *  time). This is a passive structural dependency — `ResourceProtocol`
 *  does not depend on anything panel-related. */
trait PanelProtocol extends SprayJsonSupport with DefaultJsonProtocol with ResourceProtocol {
  // Domain helpers used by panel-scoped JSON blobs (e.g. panels referenced in layout payloads)
  implicit val panelIdFormat: JsonFormat[PanelId] = new JsonFormat[PanelId] {
    def write(id: PanelId): JsValue = JsString(id.value)
    def read(json: JsValue): PanelId = json match {
      case JsString(s) => PanelId(s)
      case x           => deserializationError(s"Expected string for PanelId, got $x")
    }
  }
  implicit val panelTypeFormat: JsonFormat[PanelType] = new JsonFormat[PanelType] {
    def write(t: PanelType): JsValue = JsString(PanelType.asString(t))
    def read(json: JsValue): PanelType = json match {
      case JsString(s) => PanelType.fromString(s).fold(deserializationError(_), identity)
      case x           => deserializationError(s"Expected string for PanelType, got $x")
    }
  }

  implicit val chartLegendFormat: RootJsonFormat[ChartLegend]         = jsonFormat2(ChartLegend.apply)
  implicit val chartTooltipFormat: RootJsonFormat[ChartTooltip]       = jsonFormat1(ChartTooltip.apply)
  implicit val chartAxisLabelFormat: RootJsonFormat[ChartAxisLabel]   = jsonFormat2(ChartAxisLabel.apply)
  implicit val chartAxisLabelsFormat: RootJsonFormat[ChartAxisLabels] = jsonFormat2(ChartAxisLabels.apply)
  implicit val chartAppearanceFormat: RootJsonFormat[ChartAppearance] = jsonFormat5(ChartAppearance.apply)
  implicit val panelAppearanceFormat: RootJsonFormat[PanelAppearance] = jsonFormat4(PanelAppearance.apply)

  implicit val panelAppearancePayloadFormat: RootJsonFormat[PanelAppearancePayload]   = jsonFormat4(PanelAppearancePayload.apply)
  implicit val panelAppearanceResponseFormat: RootJsonFormat[PanelAppearanceResponse] = jsonFormat4(PanelAppearanceResponse.apply)
  implicit val panelLayoutResponseFormat: RootJsonFormat[PanelLayoutResponse]         = jsonFormat4(PanelLayoutResponse.apply)
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse]                     = jsonFormat10(PanelResponse.apply)
  implicit val panelsResponseFormat: RootJsonFormat[PanelsResponse]                   = jsonFormat1(PanelsResponse.apply)

  /** Create request — typed `config` raw `JsValue` field is resolved by
   *  the service via [[PanelConfigCodec.decodeCreateConfig]] once `type`
   *  is validated. The wire is `{ dashboardId?, title?, type?, config? }`. */
  implicit val createPanelRequestFormat: RootJsonFormat[CreatePanelRequest] = jsonFormat5(CreatePanelRequest.apply)

  /** Custom format for `UpdatePanelRequest` — `config` and `appearance` are
   *  both preserved as raw `JsValue` so the service can decode them against
   *  the stored panel's type/appearance with full absent-vs-null semantics. */
  implicit val updatePanelRequestFormat: RootJsonFormat[UpdatePanelRequest] =
    new RootJsonFormat[UpdatePanelRequest] {
      def write(r: UpdatePanelRequest): JsValue = {
        val fields = scala.collection.mutable.Map.empty[String, JsValue]
        r.title.foreach(v => fields("title") = JsString(v))
        r.appearance.foreach(v => fields("appearance") = v)
        r.`type`.foreach(v => fields("type") = JsString(v))
        r.config.foreach(v => fields("config") = v)
        JsObject(fields.toMap)
      }

      def read(json: JsValue): UpdatePanelRequest = {
        val obj = json.asJsObject
        UpdatePanelRequest(
          title      = obj.fields.get("title").map(_.convertTo[String]),
          appearance = obj.fields.get("appearance"),
          `type`     = obj.fields.get("type").map(_.convertTo[String]),
          config     = obj.fields.get("config")
        )
      }
    }

  implicit val panelBatchItemFormat: RootJsonFormat[PanelBatchItem] =
    new RootJsonFormat[PanelBatchItem] {
      def write(item: PanelBatchItem): JsValue = {
        val fields = scala.collection.mutable.Map.empty[String, JsValue]
        fields("id") = JsString(item.id)
        item.title.foreach(v => fields("title") = JsString(v))
        item.appearance.foreach(v => fields("appearance") = v)
        item.`type`.foreach(v => fields("type") = JsString(v))
        item.config.foreach(v => fields("config") = v)
        JsObject(fields.toMap)
      }

      def read(json: JsValue): PanelBatchItem = {
        val obj = json.asJsObject
        val id = obj.fields.get("id") match {
          case Some(JsString(s)) => s
          case _                 => deserializationError("PanelBatchItem.id is required")
        }
        PanelBatchItem(
          id         = id,
          title      = obj.fields.get("title").map(_.convertTo[String]),
          appearance = obj.fields.get("appearance"),
          `type`     = obj.fields.get("type").map(_.convertTo[String]),
          config     = obj.fields.get("config")
        )
      }
    }
  implicit val updatePanelsBatchRequestFormat: RootJsonFormat[UpdatePanelsBatchRequest]   = jsonFormat2(UpdatePanelsBatchRequest.apply)
  implicit val updatePanelsBatchResponseFormat: RootJsonFormat[UpdatePanelsBatchResponse] = jsonFormat1(UpdatePanelsBatchResponse.apply)

  /** Batch-create (HEL-370) — mirrors `createPanelRequestFormat`'s plain
   *  `jsonFormatN` derivation (no absent-vs-null merge semantics needed here,
   *  unlike the PATCH batch formats above: every field is create-time only). */
  implicit val createPanelBatchItemFormat: RootJsonFormat[CreatePanelBatchItem] = jsonFormat4(CreatePanelBatchItem.apply)
  implicit val createPanelsBatchRequestFormat: RootJsonFormat[CreatePanelsBatchRequest] = jsonFormat2(CreatePanelsBatchRequest.apply)
  implicit val createPanelsBatchResponseFormat: RootJsonFormat[CreatePanelsBatchResponse] = jsonFormat1(CreatePanelsBatchResponse.apply)
}
