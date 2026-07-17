package com.helio.domain

import java.time.Instant
import spray.json.JsValue

final case class DashboardId(value: String) extends AnyVal
final case class PanelId(value: String) extends AnyVal
final case class DataSourceId(value: String) extends AnyVal
final case class DataTypeId(value: String) extends AnyVal
final case class UserId(value: String) extends AnyVal
final case class PipelineId(value: String) extends AnyVal

final case class User(
    id: UserId,
    email: String,
    displayName: Option[String],
    createdAt: Instant,
    googleId: Option[String] = None,
    avatarUrl: Option[String] = None
)

final case class UserSession(
    token: String,
    userId: UserId,
    createdAt: Instant,
    expiresAt: Instant
)

final case class AuthenticatedUser(id: UserId)

final case class ApiTokenId(value: String) extends AnyVal

/** Durable Personal Access Token (HEL-148 agent-native layer, Phase 1).
 *  `tokenHash` is the SHA-256 hex of the raw `helio_pat_<random>` credential;
 *  the raw token is returned once at creation and never stored. */
final case class ApiToken(
    id: ApiTokenId,
    userId: UserId,
    tokenHash: String,
    name: String,
    createdAt: Instant,
    lastUsedAt: Option[Instant],
    expiresAt: Option[Instant]
)

sealed trait AuthProvider
object AuthProvider {
  case object Google extends AuthProvider
  case object Local  extends AuthProvider
}

sealed trait ResourceType
object ResourceType {
  case object Dashboard extends ResourceType
  case object Panel     extends ResourceType
}

sealed trait PanelType
object PanelType {
  case object Metric   extends PanelType
  case object Chart    extends PanelType
  case object Text     extends PanelType
  case object Table    extends PanelType
  case object Markdown   extends PanelType
  case object Image      extends PanelType
  case object Divider    extends PanelType
  case object Collection extends PanelType

  val Default: PanelType = Metric

  def fromString(s: String): Either[String, PanelType] = s match {
    case "metric"     => Right(Metric)
    case "chart"      => Right(Chart)
    case "text"       => Right(Text)
    case "table"      => Right(Table)
    case "markdown"   => Right(Markdown)
    case "image"      => Right(Image)
    case "divider"    => Right(Divider)
    case "collection" => Right(Collection)
    case other        => Left(s"Unknown panel type: '$other'. Valid values: metric, chart, text, table, markdown, image, divider, collection")
  }

  def asString(t: PanelType): String = t match {
    case Metric     => "metric"
    case Chart      => "chart"
    case Text       => "text"
    case Table      => "table"
    case Markdown   => "markdown"
    case Image      => "image"
    case Divider    => "divider"
    case Collection => "collection"
  }
}
final case class ResourceMeta(createdBy: String, createdAt: Instant, lastUpdated: Instant)
final case class DashboardAppearance(background: String, gridBackground: String)

final case class ChartLegend(show: Boolean, position: String)
final case class ChartTooltip(enabled: Boolean)
final case class ChartAxisLabel(show: Boolean, label: Option[String])
final case class ChartAxisLabels(x: ChartAxisLabel, y: ChartAxisLabel)
final case class ChartAppearance(
    seriesColors: Vector[String],
    legend: ChartLegend,
    tooltip: ChartTooltip,
    axisLabels: ChartAxisLabels,
    chartType: Option[String] = None
)

final case class PanelAppearance(background: String, color: String, transparency: Double, chart: Option[ChartAppearance] = None)

object ChartAppearance {
  /** Mirrors the frontend's `DEFAULT_CHART_APPEARANCE`
   *  (`PanelDetailModal.tsx`) so a proposal-created chart and a manually-
   *  edited one converge on the same look. Used as the base a proposal's
   *  chart-appearance fields (Decision 2/HEL-293) override field-by-field. */
  val Default: ChartAppearance = ChartAppearance(
    seriesColors = Vector(
      "#5470c6", "#91cc75", "#fac858", "#ee6666",
      "#73c0de", "#3ba272", "#fc8452", "#9a60b4"
    ),
    legend  = ChartLegend(show = true, position = "top"),
    tooltip = ChartTooltip(enabled = true),
    axisLabels = ChartAxisLabels(
      x = ChartAxisLabel(show = true, label = Some("X Axis")),
      y = ChartAxisLabel(show = true, label = Some("Y Axis"))
    ),
    chartType = Some("line")
  )
}
final case class DashboardLayoutItem(panelId: PanelId, x: Int, y: Int, w: Int, h: Int)
final case class DashboardLayout(
    lg: Vector[DashboardLayoutItem],
    md: Vector[DashboardLayoutItem],
    sm: Vector[DashboardLayoutItem],
    xs: Vector[DashboardLayoutItem]
)

object DashboardAppearance {
  val Default: DashboardAppearance = DashboardAppearance(
    background = "transparent",
    gridBackground = "transparent"
  )
}

object DashboardLayout {
  val Default: DashboardLayout = DashboardLayout(
    lg = Vector.empty,
    md = Vector.empty,
    sm = Vector.empty,
    xs = Vector.empty
  )
}

object PanelAppearance {
  val Default: PanelAppearance = PanelAppearance(
    background = "transparent",
    color = "inherit",
    transparency = 0.0
  )
}

final case class Dashboard(
    id: DashboardId,
    name: String,
    meta: ResourceMeta,
    appearance: DashboardAppearance,
    layout: DashboardLayout,
    ownerId: UserId
)
final case class PanelQuery(
    selectedFields: List[String],
    filters: List[JsValue],
    sort: Option[String],
    limit: Option[Int]
)

// `Panel` ADT lives in `Panel.scala` (trait + 7 typed subtypes under
// `panels/`). The pre-CS2c-3b flat case class is removed.

final case class SqlSourceConfig(
    dialect: String,
    host: String,
    port: Int,
    database: String,
    user: String,
    password: String,
    query: String
)

// `DataSource` lives in `DataSource.scala` (sealed trait + 4 typed subtypes).

sealed trait ApiKeyPlacement
object ApiKeyPlacement {
  case object Header extends ApiKeyPlacement
  case object Query  extends ApiKeyPlacement
}

sealed trait RestApiAuth
object RestApiAuth {
  case object NoAuth                                                              extends RestApiAuth
  final case class BearerAuth(token: String)                                    extends RestApiAuth
  final case class ApiKeyAuth(name: String, value: String, in: ApiKeyPlacement) extends RestApiAuth
}

final case class RestApiConfig(
    url: String,
    method: String = "GET",
    auth: RestApiAuth = RestApiAuth.NoAuth,
    headers: Map[String, String] = Map.empty
)

/** Classifies `DataFieldType` variants into two families: `Structured`
 *  (existing scalar types) and `Content` (large text / binary reference
 *  types added for the v1.4 Unstructured Data release, HEL-217). A
 *  classifier over the single `DataFieldType` hierarchy rather than a
 *  parallel ADT, so existing callers keyed off `DataFieldType` (schema
 *  inference, wire serialization) don't need a union type. */
sealed trait FieldTypeCategory
object FieldTypeCategory {
  case object Structured extends FieldTypeCategory
  case object Content    extends FieldTypeCategory
}

sealed trait DataFieldType
object DataFieldType {
  case object StringType    extends DataFieldType
  case object IntegerType   extends DataFieldType
  case object FloatType     extends DataFieldType
  case object BooleanType   extends DataFieldType
  case object TimestampType extends DataFieldType
  // Content field types (HEL-217): distinct from the structured scalars
  // above. `StringBodyType` carries a plain JSON string (e.g. extracted
  // document text); `BinaryRefType` carries a small JSON object referencing
  // a binary stored via the uploads `FileSystem` abstraction — see
  // `BinaryRef` and `BinaryRefRepository` for the durable metadata index.
  case object StringBodyType extends DataFieldType
  case object BinaryRefType  extends DataFieldType

  def asString(t: DataFieldType): String = t match {
    case StringType     => "string"
    case IntegerType    => "integer"
    case FloatType      => "float"
    case BooleanType    => "boolean"
    case TimestampType  => "timestamp"
    case StringBodyType => "string-body"
    case BinaryRefType  => "binary-ref"
  }

  /** Reverse of `asString`. Returns `None` for any string that isn't one of
   *  the 7 canonical wire values. */
  def fromString(s: String): Option[DataFieldType] = s match {
    case "string"      => Some(StringType)
    case "integer"     => Some(IntegerType)
    case "float"       => Some(FloatType)
    case "boolean"     => Some(BooleanType)
    case "timestamp"   => Some(TimestampType)
    case "string-body" => Some(StringBodyType)
    case "binary-ref"  => Some(BinaryRefType)
    case _             => None
  }

  def category(t: DataFieldType): FieldTypeCategory = t match {
    case StringType | IntegerType | FloatType | BooleanType | TimestampType =>
      FieldTypeCategory.Structured
    case StringBodyType | BinaryRefType =>
      FieldTypeCategory.Content
  }
}

final case class InferredField(name: String, displayName: String, dataType: DataFieldType, nullable: Boolean)
final case class InferredSchema(fields: Seq[InferredField])

final case class DataField(
    name: String,
    displayName: String,
    dataType: String,
    nullable: Boolean
)

final case class ComputedField(
    name: String,
    displayName: String,
    expression: String,
    dataType: String
)

final case class DataType(
    id: DataTypeId,
    sourceId: Option[DataSourceId],
    name: String,
    fields: Vector[DataField],
    computedFields: Vector[ComputedField] = Vector.empty,
    version: Int,
    createdAt: Instant,
    updatedAt: Instant,
    ownerId: UserId
)

sealed trait Role
object Role {
  case object Viewer extends Role
  case object Editor extends Role

  def fromString(s: String): Either[String, Role] = s match {
    case "viewer" => Right(Viewer)
    case "editor" => Right(Editor)
    case other    => Left(s"Unknown role: '$other'. Valid values: viewer, editor")
  }

  def asString(r: Role): String = r match {
    case Viewer => "viewer"
    case Editor => "editor"
  }
}

sealed trait ResourceAccess
object ResourceAccess {
  case object Owner  extends ResourceAccess
  case object Editor extends ResourceAccess
  case object Viewer extends ResourceAccess
}

final case class ResourcePermission(
    resourceType: String,
    resourceId: String,
    granteeId: Option[UserId],
    role: Role,
    createdAt: Instant
)

final case class Pipeline(
    id: PipelineId,
    name: String,
    sourceDataSourceId: DataSourceId,
    outputDataTypeId: DataTypeId,
    lastRunStatus: Option[String],
    lastRunAt: Option[Instant],
    createdAt: Instant,
    updatedAt: Instant,
    ownerId: UserId
)

final case class PipelineStepId(value: String) extends AnyVal
final case class PipelineRunId(value: String) extends AnyVal

// `PipelineStep` ADT lives in `Pipeline.scala` (sealed trait + 10 typed
// subtypes). The pre-CS2c-3a flat case class is removed.

/** Row-correlated metadata for a `binary-ref` field value (HEL-217). A
 *  derived secondary index over the same metadata already present in the
 *  field's inline JSONB value in `data_type_rows.data` — never an
 *  independent read path for row data. See `BinaryRefRepository`. */
final case class BinaryRef(
    id: String,
    dataTypeId: String,
    rowIndex: Int,
    fieldName: String,
    storageKey: String,
    mimeType: String,
    filename: String,
    sizeBytes: Long,
    createdAt: Instant
)

final case class ImageUploadId(value: String) extends AnyVal

/** Standalone panel-literal image upload metadata (HEL-246). Unlike
 *  [[BinaryRef]] this has no parent DataType/row — it is a direct-owner
 *  upload backing an Image panel's `imageUrl`, served back unauthenticated
 *  via `GET /api/uploads/image/:id`. See design.md Decision 1. */
final case class ImageUpload(
    id: ImageUploadId,
    ownerId: UserId,
    storageKey: String,
    mimeType: String,
    filename: String,
    sizeBytes: Long,
    createdAt: Instant
)
