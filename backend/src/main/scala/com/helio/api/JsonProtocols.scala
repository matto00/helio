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
final case class DuplicateDashboardResponse(dashboard: DashboardResponse, panels: Vector[PanelResponse])
final case class HealthResponse(status: String)
// ── Snapshot API types ────────────────────────────────────────────────────────
final case class DashboardSnapshotPanelEntry(
    snapshotId: String,
    title: String,
    `type`: String,
    appearance: PanelAppearancePayload,
    typeId: Option[String],
    fieldMapping: Option[JsValue]
)
final case class DashboardSnapshotDashboardEntry(
    name: String,
    appearance: DashboardAppearancePayload,
    layout: DashboardLayoutPayload
)
final case class DashboardSnapshotPayload(
    version: Int,
    dashboard: DashboardSnapshotDashboardEntry,
    panels: Vector[DashboardSnapshotPanelEntry]
)
final case class ErrorResponse(message: String)

// ── Google OAuth types ────────────────────────────────────────────────────────
final case class GoogleProfile(sub: String, email: Option[String], name: Option[String], picture: Option[String])

// ── Auth API types ────────────────────────────────────────────────────────────
final case class RegisterRequest(email: String, password: String, displayName: Option[String])
final case class LoginRequest(email: String, password: String)
final case class UserResponse(id: String, email: String, displayName: Option[String], createdAt: String, avatarUrl: Option[String] = None)
final case class AuthResponse(token: String, expiresAt: String, user: UserResponse)
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

// ── REST connector API types ──────────────────────────────────────────────────

final case class RestApiAuthPayload(
    `type`: String,
    token: Option[String],
    name: Option[String],
    value: Option[String],
    in: Option[String]
)
final case class RestApiConfigPayload(
    url: String,
    method: Option[String],
    auth: Option[RestApiAuthPayload],
    headers: Option[Map[String, String]]
)
final case class FieldOverridePayload(name: String, displayName: String, dataType: String)
final case class CreateSourceRequest(
    name: String,
    sourceType: String,
    config: RestApiConfigPayload,
    fieldOverrides: Option[Vector[FieldOverridePayload]]
)
final case class CreateSourceResponse(
    source: DataSourceResponse,
    dataType: Option[DataTypeResponse],
    fetchError: Option[String]
)
final case class PreviewSourceResponse(rows: Vector[JsValue])
final case class InferredFieldResponse(name: String, displayName: String, dataType: String, nullable: Boolean)
final case class InferredSchemaResponse(fields: Vector[InferredFieldResponse])

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

object RestApiConfigPayload {
  def toDomain(p: RestApiConfigPayload): Either[String, RestApiConfig] = {
    val auth: Either[String, RestApiAuth] = p.auth match {
      case None => Right(RestApiAuth.NoAuth)
      case Some(a) => a.`type` match {
        case "none"    => Right(RestApiAuth.NoAuth)
        case "bearer"  =>
          a.token.toRight("bearer auth requires 'token'").map(RestApiAuth.BearerAuth(_))
        case "api_key" =>
          for {
            name  <- a.name.toRight("api_key auth requires 'name'")
            value <- a.value.toRight("api_key auth requires 'value'")
            in    <- a.in.toRight("api_key auth requires 'in' (header or query)")
            placement <- in match {
              case "header" => Right(ApiKeyPlacement.Header)
              case "query"  => Right(ApiKeyPlacement.Query)
              case other    => Left(s"Invalid 'in' value: '$other'. Must be 'header' or 'query'")
            }
          } yield RestApiAuth.ApiKeyAuth(name, value, placement)
        case other => Left(s"Unknown auth type: '$other'. Valid values: none, bearer, api_key")
      }
    }
    auth.map(a =>
      RestApiConfig(
        url     = p.url,
        method  = p.method.getOrElse("GET"),
        auth    = a,
        headers = p.headers.getOrElse(Map.empty)
      )
    )
  }
}

object PanelAppearanceResponse {
  def fromDomain(appearance: PanelAppearance): PanelAppearanceResponse =
    PanelAppearanceResponse(
      background = appearance.background,
      color = appearance.color,
      transparency = appearance.transparency
    )
}

object DashboardSnapshotPanelEntry {
  def fromDomain(panel: Panel): DashboardSnapshotPanelEntry =
    DashboardSnapshotPanelEntry(
      snapshotId   = panel.id.value,
      title        = panel.title,
      `type`       = PanelType.asString(panel.panelType),
      appearance   = PanelAppearancePayload(
        background   = Some(panel.appearance.background),
        color        = Some(panel.appearance.color),
        transparency = Some(panel.appearance.transparency)
      ),
      typeId       = panel.typeId.map(_.value),
      fieldMapping = panel.fieldMapping
    )
}

object UserResponse {
  def fromDomain(user: com.helio.domain.User): UserResponse =
    UserResponse(
      id          = user.id.value,
      email       = user.email,
      displayName = user.displayName,
      createdAt   = user.createdAt.toString,
      avatarUrl   = user.avatarUrl
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
  implicit val duplicateDashboardResponseFormat: RootJsonFormat[DuplicateDashboardResponse] = jsonFormat2(
    DuplicateDashboardResponse.apply
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

  // REST connector API formats
  implicit val restApiAuthPayloadFormat: RootJsonFormat[RestApiAuthPayload] = jsonFormat5(RestApiAuthPayload.apply)
  implicit val restApiConfigPayloadFormat: RootJsonFormat[RestApiConfigPayload] = jsonFormat4(RestApiConfigPayload.apply)
  implicit val fieldOverridePayloadFormat: RootJsonFormat[FieldOverridePayload] = jsonFormat3(FieldOverridePayload.apply)
  implicit val createSourceRequestFormat: RootJsonFormat[CreateSourceRequest] = jsonFormat4(CreateSourceRequest.apply)
  implicit val previewSourceResponseFormat: RootJsonFormat[PreviewSourceResponse] = jsonFormat1(PreviewSourceResponse.apply)
  implicit val inferredFieldResponseFormat: RootJsonFormat[InferredFieldResponse]   = jsonFormat4(InferredFieldResponse.apply)
  implicit val inferredSchemaResponseFormat: RootJsonFormat[InferredSchemaResponse] = jsonFormat1(InferredSchemaResponse.apply)

  // DataType / DataSource API formats
  implicit val dataFieldResponseFormat: RootJsonFormat[DataFieldResponse] = jsonFormat4(DataFieldResponse.apply)
  implicit val dataTypeResponseFormat: RootJsonFormat[DataTypeResponse]   = jsonFormat7(DataTypeResponse.apply)
  implicit val dataTypesResponseFormat: RootJsonFormat[DataTypesResponse] = jsonFormat1(DataTypesResponse.apply)
  implicit val dataSourceResponseFormat: RootJsonFormat[DataSourceResponse]   = jsonFormat5(DataSourceResponse.apply)
  implicit val dataSourcesResponseFormat: RootJsonFormat[DataSourcesResponse] = jsonFormat1(DataSourcesResponse.apply)
  implicit val dataFieldPayloadFormat: RootJsonFormat[DataFieldPayload]             = jsonFormat4(DataFieldPayload.apply)
  implicit val updateDataTypeRequestFormat: RootJsonFormat[UpdateDataTypeRequest]   = jsonFormat2(UpdateDataTypeRequest.apply)
  implicit val createDataSourceRequestFormat: RootJsonFormat[CreateDataSourceRequest] = jsonFormat1(CreateDataSourceRequest.apply)
  implicit val csvPreviewResponseFormat: RootJsonFormat[CsvPreviewResponse]         = jsonFormat2(CsvPreviewResponse.apply)
  implicit val createSourceResponseFormat: RootJsonFormat[CreateSourceResponse]     = jsonFormat3(CreateSourceResponse.apply)

  // Auth API formats
  implicit val registerRequestFormat: RootJsonFormat[RegisterRequest] = jsonFormat3(RegisterRequest.apply)
  implicit val loginRequestFormat: RootJsonFormat[LoginRequest]       = jsonFormat2(LoginRequest.apply)
  implicit val userResponseFormat: RootJsonFormat[UserResponse]       = jsonFormat5(UserResponse.apply)
  implicit val authResponseFormat: RootJsonFormat[AuthResponse]       = jsonFormat3(AuthResponse.apply)

  // Google OAuth formats
  implicit val googleProfileFormat: RootJsonReader[GoogleProfile] = new RootJsonReader[GoogleProfile] {
    def read(json: JsValue): GoogleProfile = {
      val obj = json.asJsObject
      GoogleProfile(
        sub     = obj.fields("sub").convertTo[String],
        email   = obj.fields.get("email").map(_.convertTo[String]),
        name    = obj.fields.get("name").map(_.convertTo[String]),
        picture = obj.fields.get("picture").map(_.convertTo[String])
      )
    }
  }

  // Snapshot API formats
  implicit val dashboardSnapshotPanelEntryFormat: RootJsonFormat[DashboardSnapshotPanelEntry]         = jsonFormat6(DashboardSnapshotPanelEntry.apply)
  implicit val dashboardSnapshotDashboardEntryFormat: RootJsonFormat[DashboardSnapshotDashboardEntry] = jsonFormat3(DashboardSnapshotDashboardEntry.apply)
  implicit val dashboardSnapshotPayloadFormat: RootJsonFormat[DashboardSnapshotPayload]               = jsonFormat3(DashboardSnapshotPayload.apply)
}
