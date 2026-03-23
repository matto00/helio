package com.helio.api

import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Request / Response types ──────────────────────────────────────────────────

final case class ResourceMetaResponse(createdBy: String, createdAt: String, lastUpdated: String)
final case class DashboardAppearancePayload(background: Option[String], gridBackground: Option[String])
final case class DashboardLayoutItemPayload(panelId: String, x: Int, y: Int, w: Int, h: Int)
final case class DashboardLayoutPayload(
    lg: Vector[DashboardLayoutItemPayload],
    md: Vector[DashboardLayoutItemPayload],
    sm: Vector[DashboardLayoutItemPayload],
    xs: Vector[DashboardLayoutItemPayload]
)
final case class PanelAppearancePayload(background: Option[String], color: Option[String], transparency: Option[Double])
final case class DashboardAppearanceResponse(background: String, gridBackground: String)
final case class DashboardLayoutItemResponse(panelId: String, x: Int, y: Int, w: Int, h: Int)
final case class DashboardLayoutResponse(
    lg: Vector[DashboardLayoutItemResponse],
    md: Vector[DashboardLayoutItemResponse],
    sm: Vector[DashboardLayoutItemResponse],
    xs: Vector[DashboardLayoutItemResponse]
)
final case class PanelAppearanceResponse(background: String, color: String, transparency: Double)
final case class DashboardResponse(
    id: String,
    name: String,
    meta: ResourceMetaResponse,
    appearance: DashboardAppearanceResponse,
    layout: DashboardLayoutResponse
)
final case class PanelResponse(
    id: String,
    dashboardId: String,
    title: String,
    `type`: String,
    meta: ResourceMetaResponse,
    appearance: PanelAppearanceResponse,
    typeId: Option[String],
    fieldMapping: Option[JsValue]
)
final case class DashboardsResponse(items: Vector[DashboardResponse])
final case class PanelsResponse(items: Vector[PanelResponse])
final case class HealthResponse(status: String)
final case class ErrorResponse(message: String)
final case class CreateDashboardRequest(name: Option[String])
final case class CreatePanelRequest(dashboardId: Option[String], title: Option[String], `type`: Option[String])
final case class UpdateDashboardRequest(
    name: Option[String],
    appearance: Option[DashboardAppearancePayload],
    layout: Option[DashboardLayoutPayload]
)
// typeId / fieldMapping use Option[Option[_]] to distinguish absent from explicit null
final case class UpdatePanelRequest(
    title: Option[String],
    appearance: Option[PanelAppearancePayload],
    `type`: Option[String],
    typeId: Option[Option[String]],
    fieldMapping: Option[Option[JsValue]]
)

// ── DataType / DataSource API types ──────────────────────────────────────────

final case class DataFieldResponse(name: String, displayName: String, dataType: String, nullable: Boolean)
final case class DataTypeResponse(
    id: String,
    sourceId: Option[String],
    name: String,
    fields: Vector[DataFieldResponse],
    version: Int,
    createdAt: String,
    updatedAt: String
)
final case class DataTypesResponse(items: Vector[DataTypeResponse])
final case class DataSourceResponse(id: String, name: String, sourceType: String, createdAt: String, updatedAt: String)
final case class DataSourcesResponse(items: Vector[DataSourceResponse])
final case class DataFieldPayload(name: String, displayName: String, dataType: String, nullable: Boolean)
final case class UpdateDataTypeRequest(name: Option[String], fields: Option[Vector[DataFieldPayload]])
final case class CreateDataSourceRequest(name: String)
final case class CsvPreviewResponse(headers: Vector[String], rows: Vector[Vector[String]])

// ── Companion objects ─────────────────────────────────────────────────────────

object ResourceMetaResponse {
  def fromDomain(meta: ResourceMeta): ResourceMetaResponse =
    ResourceMetaResponse(
      createdBy = meta.createdBy,
      createdAt = meta.createdAt.toString,
      lastUpdated = meta.lastUpdated.toString
    )
}

object DashboardResponse {
  def fromDomain(dashboard: Dashboard): DashboardResponse =
    DashboardResponse(
      id = dashboard.id.value,
      name = dashboard.name,
      meta = ResourceMetaResponse.fromDomain(dashboard.meta),
      appearance = DashboardAppearanceResponse.fromDomain(dashboard.appearance),
      layout = DashboardLayoutResponse.fromDomain(dashboard.layout)
    )
}

object PanelResponse {
  def fromDomain(panel: Panel): PanelResponse =
    PanelResponse(
      id           = panel.id.value,
      dashboardId  = panel.dashboardId.value,
      title        = panel.title,
      `type`       = PanelType.asString(panel.panelType),
      meta         = ResourceMetaResponse.fromDomain(panel.meta),
      appearance   = PanelAppearanceResponse.fromDomain(panel.appearance),
      typeId       = panel.typeId.map(_.value),
      fieldMapping = panel.fieldMapping
    )
}

object DataTypeResponse {
  def fromDomain(dt: DataType): DataTypeResponse =
    DataTypeResponse(
      id       = dt.id.value,
      sourceId = dt.sourceId.map(_.value),
      name     = dt.name,
      fields   = dt.fields.map(f => DataFieldResponse(f.name, f.displayName, f.dataType, f.nullable)),
      version  = dt.version,
      createdAt = dt.createdAt.toString,
      updatedAt = dt.updatedAt.toString
    )
}

object DataSourceResponse {
  def fromDomain(ds: DataSource): DataSourceResponse =
    DataSourceResponse(
      id         = ds.id.value,
      name       = ds.name,
      sourceType = SourceType.asString(ds.sourceType),
      createdAt  = ds.createdAt.toString,
      updatedAt  = ds.updatedAt.toString
    )
}

object DashboardAppearanceResponse {
  def fromDomain(appearance: DashboardAppearance): DashboardAppearanceResponse =
    DashboardAppearanceResponse(
      background = appearance.background,
      gridBackground = appearance.gridBackground
    )
}

object DashboardLayoutItemPayload {
  def toDomain(item: DashboardLayoutItemPayload): DashboardLayoutItem =
    DashboardLayoutItem(
      panelId = PanelId(item.panelId),
      x = item.x,
      y = item.y,
      w = item.w,
      h = item.h
    )
}

object DashboardLayoutPayload {
  def toDomain(layout: DashboardLayoutPayload): DashboardLayout =
    DashboardLayout(
      lg = layout.lg.map(DashboardLayoutItemPayload.toDomain),
      md = layout.md.map(DashboardLayoutItemPayload.toDomain),
      sm = layout.sm.map(DashboardLayoutItemPayload.toDomain),
      xs = layout.xs.map(DashboardLayoutItemPayload.toDomain)
    )
}

object DashboardLayoutItemResponse {
  def fromDomain(item: DashboardLayoutItem): DashboardLayoutItemResponse =
    DashboardLayoutItemResponse(
      panelId = item.panelId.value,
      x = item.x,
      y = item.y,
      w = item.w,
      h = item.h
    )
}

object DashboardLayoutResponse {
  def fromDomain(layout: DashboardLayout): DashboardLayoutResponse =
    DashboardLayoutResponse(
      lg = layout.lg.map(DashboardLayoutItemResponse.fromDomain),
      md = layout.md.map(DashboardLayoutItemResponse.fromDomain),
      sm = layout.sm.map(DashboardLayoutItemResponse.fromDomain),
      xs = layout.xs.map(DashboardLayoutItemResponse.fromDomain)
    )
}

object PanelAppearanceResponse {
  def fromDomain(appearance: PanelAppearance): PanelAppearanceResponse =
    PanelAppearanceResponse(
      background = appearance.background,
      color = appearance.color,
      transparency = appearance.transparency
    )
}

// ── JsonProtocols trait ───────────────────────────────────────────────────────

trait JsonProtocols extends SprayJsonSupport with DefaultJsonProtocol {
  // DataField / DataSource / DataType formatters
  implicit val sourceTypeFormat: JsonFormat[SourceType] = new JsonFormat[SourceType] {
    def write(t: SourceType): JsValue = JsString(SourceType.asString(t))
    def read(json: JsValue): SourceType = json match {
      case JsString(s) => SourceType.fromString(s).fold(deserializationError(_), identity)
      case x           => deserializationError(s"Expected string for SourceType, got $x")
    }
  }
  implicit val dataFieldFormat: RootJsonFormat[DataField] = jsonFormat4(DataField.apply)

  // Domain type formatters (used for JSON blob persistence)
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
  implicit val dashboardAppearanceFormat: RootJsonFormat[DashboardAppearance]     = jsonFormat2(DashboardAppearance.apply)
  implicit val dashboardLayoutItemFormat: RootJsonFormat[DashboardLayoutItem]     = jsonFormat5(DashboardLayoutItem.apply)
  implicit val dashboardLayoutFormat: RootJsonFormat[DashboardLayout]             = jsonFormat4(DashboardLayout.apply)
  implicit val panelAppearanceFormat: RootJsonFormat[PanelAppearance]             = jsonFormat3(PanelAppearance.apply)

  implicit val resourceMetaResponseFormat: RootJsonFormat[ResourceMetaResponse] = jsonFormat3(
    ResourceMetaResponse.apply
  )
  implicit val dashboardAppearancePayloadFormat: RootJsonFormat[DashboardAppearancePayload] = jsonFormat2(
    DashboardAppearancePayload.apply
  )
  implicit val dashboardLayoutItemPayloadFormat: RootJsonFormat[DashboardLayoutItemPayload] = jsonFormat5(
    DashboardLayoutItemPayload.apply
  )
  implicit val dashboardLayoutPayloadFormat: RootJsonFormat[DashboardLayoutPayload] = jsonFormat4(
    DashboardLayoutPayload.apply
  )
  implicit val panelAppearancePayloadFormat: RootJsonFormat[PanelAppearancePayload] = jsonFormat3(
    PanelAppearancePayload.apply
  )
  implicit val dashboardAppearanceResponseFormat: RootJsonFormat[DashboardAppearanceResponse] = jsonFormat2(
    DashboardAppearanceResponse.apply
  )
  implicit val dashboardLayoutItemResponseFormat: RootJsonFormat[DashboardLayoutItemResponse] = jsonFormat5(
    DashboardLayoutItemResponse.apply
  )
  implicit val dashboardLayoutResponseFormat: RootJsonFormat[DashboardLayoutResponse] = jsonFormat4(
    DashboardLayoutResponse.apply
  )
  implicit val panelAppearanceResponseFormat: RootJsonFormat[PanelAppearanceResponse] = jsonFormat3(
    PanelAppearanceResponse.apply
  )
  implicit val dashboardResponseFormat: RootJsonFormat[DashboardResponse] = jsonFormat5(
    DashboardResponse.apply
  )
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse] = jsonFormat8(PanelResponse.apply)
  implicit val dashboardsResponseFormat: RootJsonFormat[DashboardsResponse] = jsonFormat1(
    DashboardsResponse.apply
  )
  implicit val panelsResponseFormat: RootJsonFormat[PanelsResponse] = jsonFormat1(
    PanelsResponse.apply
  )
  implicit val healthResponseFormat: RootJsonFormat[HealthResponse] = jsonFormat1(
    HealthResponse.apply
  )
  implicit val errorResponseFormat: RootJsonFormat[ErrorResponse] = jsonFormat1(ErrorResponse.apply)
  implicit val createDashboardRequestFormat: RootJsonFormat[CreateDashboardRequest] = jsonFormat1(
    CreateDashboardRequest.apply
  )
  implicit val createPanelRequestFormat: RootJsonFormat[CreatePanelRequest] = jsonFormat3(
    CreatePanelRequest.apply
  )
  implicit val updateDashboardRequestFormat: RootJsonFormat[UpdateDashboardRequest] = jsonFormat3(
    UpdateDashboardRequest.apply
  )

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
        JsObject(fields.toMap)
      }

      def read(json: JsValue): UpdatePanelRequest = {
        val obj = json.asJsObject
        UpdatePanelRequest(
          title      = obj.fields.get("title").map(_.convertTo[String]),
          appearance = obj.fields.get("appearance").map(_.convertTo[PanelAppearancePayload]),
          `type`     = obj.fields.get("type").map(_.convertTo[String]),
          typeId = obj.fields.get("typeId") match {
            case None               => None
            case Some(JsNull)       => Some(None)
            case Some(JsString(s))  => Some(Some(s))
            case Some(x)            => deserializationError(s"typeId must be a string or null, got $x")
          },
          fieldMapping = obj.fields.get("fieldMapping") match {
            case None         => None
            case Some(JsNull) => Some(None)
            case Some(v)      => Some(Some(v))
          }
        )
      }
    }

  // DataType / DataSource API formats
  implicit val dataFieldResponseFormat: RootJsonFormat[DataFieldResponse] = jsonFormat4(DataFieldResponse.apply)
  implicit val dataTypeResponseFormat: RootJsonFormat[DataTypeResponse]   = jsonFormat7(DataTypeResponse.apply)
  implicit val dataTypesResponseFormat: RootJsonFormat[DataTypesResponse] = jsonFormat1(DataTypesResponse.apply)
  implicit val dataSourceResponseFormat: RootJsonFormat[DataSourceResponse]   = jsonFormat5(DataSourceResponse.apply)
  implicit val dataSourcesResponseFormat: RootJsonFormat[DataSourcesResponse] = jsonFormat1(DataSourcesResponse.apply)
  implicit val dataFieldPayloadFormat: RootJsonFormat[DataFieldPayload]           = jsonFormat4(DataFieldPayload.apply)
  implicit val updateDataTypeRequestFormat: RootJsonFormat[UpdateDataTypeRequest] = jsonFormat2(UpdateDataTypeRequest.apply)
  implicit val createDataSourceRequestFormat: RootJsonFormat[CreateDataSourceRequest] = jsonFormat1(CreateDataSourceRequest.apply)
  implicit val csvPreviewResponseFormat: RootJsonFormat[CsvPreviewResponse]       = jsonFormat2(CsvPreviewResponse.apply)
}
