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
  case object Markdown extends PanelType
  case object Image    extends PanelType
  case object Divider  extends PanelType

  val Default: PanelType = Metric

  def fromString(s: String): Either[String, PanelType] = s match {
    case "metric"   => Right(Metric)
    case "chart"    => Right(Chart)
    case "text"     => Right(Text)
    case "table"    => Right(Table)
    case "markdown" => Right(Markdown)
    case "image"    => Right(Image)
    case "divider"  => Right(Divider)
    case other      => Left(s"Unknown panel type: '$other'. Valid values: metric, chart, text, table, markdown, image, divider")
  }

  def asString(t: PanelType): String = t match {
    case Metric   => "metric"
    case Chart    => "chart"
    case Text     => "text"
    case Table    => "table"
    case Markdown => "markdown"
    case Image    => "image"
    case Divider  => "divider"
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

sealed trait DataFieldType
object DataFieldType {
  case object StringType    extends DataFieldType
  case object IntegerType   extends DataFieldType
  case object FloatType     extends DataFieldType
  case object BooleanType   extends DataFieldType
  case object TimestampType extends DataFieldType

  def asString(t: DataFieldType): String = t match {
    case StringType    => "string"
    case IntegerType   => "integer"
    case FloatType     => "float"
    case BooleanType   => "boolean"
    case TimestampType => "timestamp"
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
