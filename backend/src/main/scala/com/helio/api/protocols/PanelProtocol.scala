package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import com.helio.domain.panels._
import spray.json._

// ── Panel request / response types ───────────────────────────────────────────

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

/** CS2c-3c discriminated wire shape: every panel response carries a `type`
 *  discriminator and a typed `config` payload whose shape is determined by
 *  the discriminator. Per-subtype flat nullable fields at the response root
 *  are gone — readers narrow on `type` and read fields from `config`.
 *
 *  `dataAsOf` (HEL-234): ISO-8601 timestamp of the most recent successful
 *  pipeline run that writes to this panel's bound DataType; `None` (→ JSON
 *  `null`) when the panel has no bound DataType or no pipeline has run. */
final case class PanelResponse(
    id: String,
    dashboardId: String,
    title: String,
    `type`: String,
    meta: ResourceMetaResponse,
    appearance: PanelAppearanceResponse,
    ownerId: String,
    config: JsValue,
    dataAsOf: Option[String]
)
final case class PanelsResponse(items: Vector[PanelResponse])

/** Create request — `{ dashboardId, title?, type, config }`. `config` is a
 *  typed JSON object whose shape is determined by `type`; the per-subtype
 *  decoder under `domain/panels` resolves it (tolerant of `{}`). */
final case class CreatePanelRequest(
    dashboardId: Option[String],
    title: Option[String],
    `type`: Option[String],
    config: Option[JsValue]
)

/** Update request — `{ title?, appearance?, type?, config? }`. `config`
 *  (when present) carries a typed patch whose shape matches the request's
 *  `type` (and at the service layer, the stored panel's type — cross-type
 *  PATCH is rejected with 400). Within `config`, fields use absent-vs-null
 *  semantics per the per-subtype `Patch.decode`. */
final case class UpdatePanelRequest(
    title: Option[String],
    appearance: Option[PanelAppearancePayload],
    `type`: Option[String],
    config: Option[JsValue]
)

/** Batch entry mirrors the single-update shape. */
final case class PanelBatchItem(
    id: String,
    title: Option[String],
    appearance: Option[PanelAppearancePayload],
    `type`: Option[String],
    config: Option[JsValue]
)
final case class UpdatePanelsBatchRequest(fields: Vector[String], panels: Vector[PanelBatchItem])
final case class UpdatePanelsBatchResponse(panels: Vector[PanelResponse])

object PanelResponse {

  /** Build a discriminated-wire response from the typed `Panel` ADT.
   *
   *  CS2c-3c collapses the prior wide-flat shape (8 nullable subtype fields
   *  at the root) to `type` + typed `config`. Per-subtype `*Config` already
   *  carries a `RootJsonFormat`; this dispatcher selects it and emits the
   *  config payload as the `config` field.
   *
   *  `dataAsOf` (HEL-234): pass the ISO timestamp from
   *  `PipelineRepository.findLastRunAtByOutputDataTypeId` for panels with a
   *  bound DataType; pass `None` for all other call sites. */
  def fromDomain(panel: Panel, dataAsOf: Option[String] = None): PanelResponse =
    PanelResponse(
      id          = panel.id.value,
      dashboardId = panel.dashboardId.value,
      title       = panel.title,
      `type`      = panel.kind,
      meta        = ResourceMetaResponse.fromDomain(panel.meta),
      appearance  = PanelAppearanceResponse.fromDomain(panel.appearance),
      ownerId     = panel.ownerId.value,
      config      = PanelConfigCodec.encodeConfig(panel),
      dataAsOf    = dataAsOf
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

  // Chart appearance sub-types (panel-scoped)
  implicit val chartLegendFormat: RootJsonFormat[ChartLegend]         = jsonFormat2(ChartLegend.apply)
  implicit val chartTooltipFormat: RootJsonFormat[ChartTooltip]       = jsonFormat1(ChartTooltip.apply)
  implicit val chartAxisLabelFormat: RootJsonFormat[ChartAxisLabel]   = jsonFormat2(ChartAxisLabel.apply)
  implicit val chartAxisLabelsFormat: RootJsonFormat[ChartAxisLabels] = jsonFormat2(ChartAxisLabels.apply)
  implicit val chartAppearanceFormat: RootJsonFormat[ChartAppearance] = jsonFormat5(ChartAppearance.apply)
  implicit val panelAppearanceFormat: RootJsonFormat[PanelAppearance] = jsonFormat4(PanelAppearance.apply)

  // Panel request / response formats
  implicit val panelAppearancePayloadFormat: RootJsonFormat[PanelAppearancePayload]   = jsonFormat4(PanelAppearancePayload.apply)
  implicit val panelAppearanceResponseFormat: RootJsonFormat[PanelAppearanceResponse] = jsonFormat4(PanelAppearanceResponse.apply)
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse]                     = jsonFormat9(PanelResponse.apply)
  implicit val panelsResponseFormat: RootJsonFormat[PanelsResponse]                   = jsonFormat1(PanelsResponse.apply)

  /** Create request — typed `config` raw `JsValue` field is resolved by
   *  the service via [[PanelConfigCodec.decodeCreateConfig]] once `type`
   *  is validated. The wire is `{ dashboardId?, title?, type?, config? }`. */
  implicit val createPanelRequestFormat: RootJsonFormat[CreatePanelRequest] = jsonFormat4(CreatePanelRequest.apply)

  /** Custom format for `UpdatePanelRequest` — `config` is preserved as a
   *  raw `JsValue` so the service can decode it against the stored panel's
   *  type with full absent-vs-null semantics. */
  implicit val updatePanelRequestFormat: RootJsonFormat[UpdatePanelRequest] =
    new RootJsonFormat[UpdatePanelRequest] {
      def write(r: UpdatePanelRequest): JsValue = {
        val fields = scala.collection.mutable.Map.empty[String, JsValue]
        r.title.foreach(v => fields("title") = JsString(v))
        r.appearance.foreach(v => fields("appearance") = v.toJson)
        r.`type`.foreach(v => fields("type") = JsString(v))
        r.config.foreach(v => fields("config") = v)
        JsObject(fields.toMap)
      }

      def read(json: JsValue): UpdatePanelRequest = {
        val obj = json.asJsObject
        UpdatePanelRequest(
          title      = obj.fields.get("title").map(_.convertTo[String]),
          appearance = obj.fields.get("appearance").map(_.convertTo[PanelAppearancePayload]),
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
        item.appearance.foreach(v => fields("appearance") = v.toJson)
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
          appearance = obj.fields.get("appearance").map(_.convertTo[PanelAppearancePayload]),
          `type`     = obj.fields.get("type").map(_.convertTo[String]),
          config     = obj.fields.get("config")
        )
      }
    }
  implicit val updatePanelsBatchRequestFormat: RootJsonFormat[UpdatePanelsBatchRequest]   = jsonFormat2(UpdatePanelsBatchRequest.apply)
  implicit val updatePanelsBatchResponseFormat: RootJsonFormat[UpdatePanelsBatchResponse] = jsonFormat1(UpdatePanelsBatchResponse.apply)

  // PanelQuery format (domain type sent to clients as a derived response)
  implicit val panelQueryFormat: RootJsonFormat[PanelQuery] = new RootJsonFormat[PanelQuery] {
    def write(q: PanelQuery): JsValue = JsObject(
      "selectedFields" -> JsArray(q.selectedFields.map(JsString(_)).toVector),
      "filters"        -> JsArray(q.filters.toVector),
      "sort"           -> q.sort.fold[JsValue](JsNull)(JsString(_)),
      "limit"          -> q.limit.fold[JsValue](JsNull)(JsNumber(_))
    )
    def read(json: JsValue): PanelQuery = {
      val obj = json.asJsObject
      PanelQuery(
        selectedFields = obj.fields.get("selectedFields").map(_.convertTo[List[String]]).getOrElse(Nil),
        filters        = obj.fields.get("filters").map(_.convertTo[List[JsValue]]).getOrElse(Nil),
        sort           = obj.fields.get("sort").flatMap { case JsNull => None; case JsString(s) => Some(s); case _ => None },
        limit          = obj.fields.get("limit").flatMap { case JsNull => None; case JsNumber(n) => Some(n.toInt); case _ => None }
      )
    }
  }
}
