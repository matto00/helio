package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
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
final case class PanelResponse(
    id: String,
    dashboardId: String,
    title: String,
    `type`: String,
    meta: ResourceMetaResponse,
    appearance: PanelAppearanceResponse,
    typeId: Option[String],
    fieldMapping: Option[JsValue],
    ownerId: String,
    content: Option[String] = None,
    imageUrl: Option[String] = None,
    imageFit: Option[String] = None,
    dividerOrientation: Option[String] = None,
    dividerWeight: Option[Int] = None,
    dividerColor: Option[String] = None
)
final case class PanelsResponse(items: Vector[PanelResponse])
final case class CreatePanelRequest(
    dashboardId: Option[String],
    title: Option[String],
    `type`: Option[String],
    content: Option[String] = None,
    dataTypeId: Option[String] = None
)
// typeId / fieldMapping use Option[Option[_]] to distinguish absent from explicit null
final case class UpdatePanelRequest(
    title: Option[String],
    appearance: Option[PanelAppearancePayload],
    `type`: Option[String],
    typeId: Option[Option[String]],
    fieldMapping: Option[Option[JsValue]],
    content: Option[String] = None,
    imageUrl: Option[String] = None,
    imageFit: Option[String] = None,
    dividerOrientation: Option[String] = None,
    dividerWeight: Option[Int] = None,
    dividerColor: Option[String] = None
)
final case class PanelBatchItem(
    id: String,
    title: Option[String],
    appearance: Option[PanelAppearancePayload],
    `type`: Option[String]
)
final case class UpdatePanelsBatchRequest(fields: Vector[String], panels: Vector[PanelBatchItem])
final case class UpdatePanelsBatchResponse(panels: Vector[PanelResponse])

object PanelResponse {
  def fromDomain(panel: Panel): PanelResponse =
    PanelResponse(
      id                  = panel.id.value,
      dashboardId         = panel.dashboardId.value,
      title               = panel.title,
      `type`              = PanelType.asString(panel.panelType),
      meta                = ResourceMetaResponse.fromDomain(panel.meta),
      appearance          = PanelAppearanceResponse.fromDomain(panel.appearance),
      typeId              = panel.typeId.map(_.value),
      fieldMapping        = panel.fieldMapping,
      ownerId             = panel.ownerId.value,
      content             = panel.content,
      imageUrl            = panel.imageUrl,
      imageFit            = panel.imageFit,
      dividerOrientation  = panel.dividerOrientation,
      dividerWeight       = panel.dividerWeight,
      dividerColor        = panel.dividerColor
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
 *  `ResourceMetaResponse` (and thus `panelResponseFormat`'s `jsonFormat15`
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
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse]                     = jsonFormat15(PanelResponse.apply)
  implicit val panelsResponseFormat: RootJsonFormat[PanelsResponse]                   = jsonFormat1(PanelsResponse.apply)
  implicit val createPanelRequestFormat: RootJsonFormat[CreatePanelRequest]           = jsonFormat5(CreatePanelRequest.apply)

  // Custom format to distinguish absent fields from explicit null for typeId / fieldMapping
  implicit val updatePanelRequestFormat: RootJsonFormat[UpdatePanelRequest] =
    new RootJsonFormat[UpdatePanelRequest] {
      def write(r: UpdatePanelRequest): JsValue = {
        val fields = scala.collection.mutable.Map.empty[String, JsValue]
        r.title.foreach(v => fields("title") = JsString(v))
        r.appearance.foreach(v => fields("appearance") = v.toJson)
        r.`type`.foreach(v => fields("type") = JsString(v))
        r.typeId.foreach {
          case None    => fields("typeId") = JsNull
          case Some(s) => fields("typeId") = JsString(s)
        }
        r.fieldMapping.foreach {
          case None    => fields("fieldMapping") = JsNull
          case Some(v) => fields("fieldMapping") = v
        }
        r.content.foreach(v => fields("content") = JsString(v))
        r.imageUrl.foreach(v => fields("imageUrl") = JsString(v))
        r.imageFit.foreach(v => fields("imageFit") = JsString(v))
        r.dividerOrientation.foreach(v => fields("dividerOrientation") = JsString(v))
        r.dividerWeight.foreach(v => fields("dividerWeight") = JsNumber(v))
        r.dividerColor.foreach(v => fields("dividerColor") = JsString(v))
        JsObject(fields.toMap)
      }

      def read(json: JsValue): UpdatePanelRequest = {
        val obj = json.asJsObject
        UpdatePanelRequest(
          title      = obj.fields.get("title").map(_.convertTo[String]),
          appearance = obj.fields.get("appearance").map(_.convertTo[PanelAppearancePayload]),
          `type`     = obj.fields.get("type").map(_.convertTo[String]),
          typeId = obj.fields.get("typeId") match {
            case None              => None
            case Some(JsNull)      => Some(None)
            case Some(JsString(s)) => Some(Some(s))
            case Some(x)           => deserializationError(s"typeId must be a string or null, got $x")
          },
          fieldMapping = obj.fields.get("fieldMapping") match {
            case None         => None
            case Some(JsNull) => Some(None)
            case Some(v)      => Some(Some(v))
          },
          content             = obj.fields.get("content").map(_.convertTo[String]),
          imageUrl            = obj.fields.get("imageUrl").map(_.convertTo[String]),
          imageFit            = obj.fields.get("imageFit").map(_.convertTo[String]),
          dividerOrientation  = obj.fields.get("dividerOrientation").map(_.convertTo[String]),
          dividerWeight       = obj.fields.get("dividerWeight").map(_.convertTo[Int]),
          dividerColor        = obj.fields.get("dividerColor").map(_.convertTo[String])
        )
      }
    }

  implicit val panelBatchItemFormat: RootJsonFormat[PanelBatchItem]                       = jsonFormat4(PanelBatchItem.apply)
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
