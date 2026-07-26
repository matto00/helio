package com.helio.domain

import com.helio.api.RequestValidation
import java.time.Instant
import org.slf4j.LoggerFactory
import spray.json._

final case class DashboardId(value: String) extends AnyVal
final case class PanelId(value: String) extends AnyVal
final case class DataSourceId(value: String) extends AnyVal
final case class DataTypeId(value: String) extends AnyVal
final case class UserId(value: String) extends AnyVal
final case class PipelineId(value: String) extends AnyVal
final case class AlertRuleId(value: String) extends AnyVal
final case class PipelineScheduleId(value: String) extends AnyVal

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
  case object Timeline   extends PanelType

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
    case "timeline"   => Right(Timeline)
    case other        => Left(s"Unknown panel type: '$other'. Valid values: metric, chart, text, table, markdown, image, divider, collection, timeline")
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
    case Timeline   => "timeline"
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

  /** Update-side patch carrying absent-vs-null per field (outer `None` =
   *  absent/keep, `Some(None)` = explicit null/clear, `Some(Some(v))` = set)
   *  — the same idiom as `MetricPanelConfig.Patch` (HEL-362).
   *
   *  `chartType` is the one field-level exception to "null resets to
   *  `Default`": `chartType: null` clears to `None` (matching today's
   *  absent-chartType-renders-as-line fallback), never
   *  `Default.chartType` (`"line"`) — see `applyPatch`. */
  final case class Patch(
      seriesColors: Option[Option[Vector[String]]],
      legend: Option[Option[ChartLegend]],
      tooltip: Option[Option[ChartTooltip]],
      axisLabels: Option[Option[ChartAxisLabels]],
      chartType: Option[Option[String]]
  ) {
    def isEmpty: Boolean =
      seriesColors.isEmpty && legend.isEmpty && tooltip.isEmpty && axisLabels.isEmpty && chartType.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None, None, None)

    /** Each provided field replaces the stored value wholesale (no merge
     *  inside `legend`/`tooltip`/`axisLabels` themselves — HEL-362 design.md
     *  Non-Goals). `chartType` is validated against the allowed set
     *  (`RequestValidation.validateChartType`) at decode time, mirroring
     *  `DividerPanelConfig.Patch.decode`'s `orientation` validation. */
    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val seriesColors = fields.get("seriesColors") match {
          case None                 => None
          case Some(JsNull)         => Some(None)
          case Some(JsArray(elems)) => Some(Some(elems.map(decodeColor)))
          case Some(x)               => deserializationError(s"seriesColors must be an array of strings or null, got $x")
        }
        val legend = fields.get("legend") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(decodeLegend(o)))
          case Some(x)            => deserializationError(s"legend must be an object or null, got $x")
        }
        val tooltip = fields.get("tooltip") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(decodeTooltip(o)))
          case Some(x)            => deserializationError(s"tooltip must be an object or null, got $x")
        }
        val axisLabels = fields.get("axisLabels") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(decodeAxisLabels(o)))
          case Some(x)            => deserializationError(s"axisLabels must be an object or null, got $x")
        }
        val chartType = fields.get("chartType") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) =>
            RequestValidation.validateChartType(Some(s)) match {
              case Right(_)  => Some(Some(s))
              case Left(err) => deserializationError(err)
            }
          case Some(x) => deserializationError(s"chartType must be a string or null, got $x")
        }
        Patch(seriesColors, legend, tooltip, axisLabels, chartType)
      case _ => Empty
    }

    private def decodeColor(json: JsValue): String = json match {
      case JsString(s) => s
      case x            => deserializationError(s"seriesColors elements must be strings, got $x")
    }

    private def decodeLegend(obj: JsObject): ChartLegend = {
      val show = obj.fields.get("show") match {
        case Some(JsBoolean(b)) => b
        case other              => deserializationError(s"legend.show must be a boolean, got ${other.getOrElse(JsNull)}")
      }
      val position = obj.fields.get("position") match {
        case Some(JsString(s)) => s
        case other              => deserializationError(s"legend.position must be a string, got ${other.getOrElse(JsNull)}")
      }
      ChartLegend(show, position)
    }

    private def decodeTooltip(obj: JsObject): ChartTooltip = {
      val enabled = obj.fields.get("enabled") match {
        case Some(JsBoolean(b)) => b
        case other              => deserializationError(s"tooltip.enabled must be a boolean, got ${other.getOrElse(JsNull)}")
      }
      ChartTooltip(enabled)
    }

    private def decodeAxisLabel(obj: JsObject, axis: String): ChartAxisLabel = {
      val show = obj.fields.get("show") match {
        case Some(JsBoolean(b)) => b
        case other              => deserializationError(s"axisLabels.$axis.show must be a boolean, got ${other.getOrElse(JsNull)}")
      }
      val label = obj.fields.get("label") match {
        case None | Some(JsNull) => None
        case Some(JsString(s))   => Some(s)
        case Some(x)              => deserializationError(s"axisLabels.$axis.label must be a string or null, got $x")
      }
      ChartAxisLabel(show, label)
    }

    private def decodeAxisLabels(obj: JsObject): ChartAxisLabels = {
      val x = obj.fields.get("x") match {
        case Some(o: JsObject) => decodeAxisLabel(o, "x")
        case other              => deserializationError(s"axisLabels.x must be an object, got ${other.getOrElse(JsNull)}")
      }
      val y = obj.fields.get("y") match {
        case Some(o: JsObject) => decodeAxisLabel(o, "y")
        case other              => deserializationError(s"axisLabels.y must be an object, got ${other.getOrElse(JsNull)}")
      }
      ChartAxisLabels(x, y)
    }
  }

  /** Merge a decoded patch over the stored `ChartAppearance` — absent keeps
   *  `existing`, explicit null resets to `Default`'s field, provided sets.
   *  `chartType` alone breaks that null-resets-to-`Default` rule: `identity`
   *  passes `Some(None)` straight through to `None` rather than falling back
   *  to `Default.chartType`. */
  def applyPatch(patch: Patch, existing: ChartAppearance): ChartAppearance = ChartAppearance(
    seriesColors = patch.seriesColors.fold(existing.seriesColors)(_.getOrElse(Default.seriesColors)),
    legend       = patch.legend.fold(existing.legend)(_.getOrElse(Default.legend)),
    tooltip      = patch.tooltip.fold(existing.tooltip)(_.getOrElse(Default.tooltip)),
    axisLabels   = patch.axisLabels.fold(existing.axisLabels)(_.getOrElse(Default.axisLabels)),
    chartType    = patch.chartType.fold(existing.chartType)(identity)
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

  private val log = LoggerFactory.getLogger(getClass)

  /** Update-side patch carrying absent-vs-null per top-level field, mirroring
   *  `ChartAppearance.Patch` (HEL-362). Merge is shallow at this level —
   *  `chart` delegates to its own field-level `ChartAppearance.Patch`. */
  final case class Patch(
      background: Option[Option[String]],
      color: Option[Option[String]],
      transparency: Option[Option[Double]],
      chart: Option[Option[ChartAppearance.Patch]]
  ) {
    def isEmpty: Boolean = background.isEmpty && color.isEmpty && transparency.isEmpty && chart.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None, None)

    // `background`/`color`/`transparency` route a *provided* value through the
    // same `RequestValidation.normalize*` calls the pre-HEL-362 full-replace
    // path used (trim + blank-collapses-to-Default for strings; clamp to
    // [0, 1] for transparency) so a full payload merges to an identical
    // result as today's replace (backward-compat acceptance criterion).
    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val background = fields.get("background") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(RequestValidation.normalizePanelBackground(Some(s))))
          case Some(x)            => deserializationError(s"background must be a string or null, got $x")
        }
        val color = fields.get("color") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(RequestValidation.normalizePanelColor(Some(s))))
          case Some(x)            => deserializationError(s"color must be a string or null, got $x")
        }
        val transparency = fields.get("transparency") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsNumber(n)) => Some(Some(RequestValidation.normalizeTransparency(Some(n.toDouble))))
          case Some(x)            => deserializationError(s"transparency must be a number or null, got $x")
        }
        val chart = fields.get("chart") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(ChartAppearance.Patch.decode(o)))
          case Some(x)            => deserializationError(s"chart must be an object or null, got $x")
        }
        Patch(background, color, transparency, chart)
      case _ => Empty
    }
  }

  /** Merge a decoded patch over the stored `PanelAppearance`. `chart: null`
   *  clears the sub-object entirely (`None`); a provided `chart` patch merges
   *  field-by-field over the stored chart (or `ChartAppearance.Default` when
   *  the panel has none). */
  def applyPatch(patch: Patch, existing: PanelAppearance): PanelAppearance = PanelAppearance(
    background   = patch.background.fold(existing.background)(_.getOrElse(Default.background)),
    color        = patch.color.fold(existing.color)(_.getOrElse(Default.color)),
    transparency = patch.transparency.fold(existing.transparency)(_.getOrElse(Default.transparency)),
    chart = patch.chart.fold(existing.chart) {
      case None            => None
      case Some(chartPatch) =>
        Some(ChartAppearance.applyPatch(chartPatch, existing.chart.getOrElse(ChartAppearance.Default)))
    }
  )

  /** Decode + merge a wire-shape appearance patch against the panel's stored
   *  appearance in one step, catching malformed shapes as a client-safe
   *  `Left`. `DeserializationException` messages are always curated/static
   *  text authored via `deserializationError(...)` above — never a wrapped
   *  raw exception — so they are safe to return to the client. Mirrors
   *  `PanelConfigCodec.safe`. */
  def applyPatchJson(json: JsValue, existing: PanelAppearance): Either[String, PanelAppearance] =
    try Right(applyPatch(Patch.decode(json), existing))
    catch {
      case d: DeserializationException => Left(d.getMessage)
      case e: Throwable =>
        log.error("appearance patch decode failed", e)
        Left("appearance patch decode failed")
    }
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
    ownerId: UserId,
    // HEL-366: optional free-form grouping tag. For a source-companion
    // DataType this mirrors its owning DataSource's tag; for a pipeline
    // output DataType this mirrors its producing Pipeline's tag (both
    // propagated at create time — see design.md Decision 6 / tasks.md 2.3).
    tag: Option[String] = None
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
    ownerId: UserId,
    // HEL-366: optional free-form grouping tag, set only at create time.
    tag: Option[String] = None
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

/** HEL-447 — alerting persistence foundation (no evaluation logic here; that
 *  is the engine ticket, HEL-455). Mirrors the `Role` enum pattern. */
sealed trait Severity
object Severity {
  case object Info     extends Severity
  case object Warning  extends Severity
  case object Critical extends Severity

  def fromString(s: String): Either[String, Severity] = s match {
    case "info"     => Right(Info)
    case "warning"  => Right(Warning)
    case "critical" => Right(Critical)
    case other      => Left(s"Unknown severity: '$other'. Valid values: info, warning, critical")
  }

  def asString(s: Severity): String = s match {
    case Info     => "info"
    case Warning  => "warning"
    case Critical => "critical"
  }
}

/** Comparator kinds understood inside an `AlertRule.condition` jsonb blob.
 *  Not a DB column of its own — `condition` stays an opaque `JsValue` at the
 *  domain layer (design.md Decision: "condition representation") so future
 *  condition kinds don't require a migration. This enum exists purely so the
 *  service layer can validate the `comparator` key's value on write. */
sealed trait Comparator
object Comparator {
  case object Gt  extends Comparator
  case object Gte extends Comparator
  case object Lt  extends Comparator
  case object Lte extends Comparator
  case object Eq  extends Comparator
  case object Neq extends Comparator

  def fromString(s: String): Either[String, Comparator] = s match {
    case "gt"  => Right(Gt)
    case "gte" => Right(Gte)
    case "lt"  => Right(Lt)
    case "lte" => Right(Lte)
    case "eq"  => Right(Eq)
    case "neq" => Right(Neq)
    case other => Left(s"Unknown comparator: '$other'. Valid values: gt, gte, lt, lte, eq, neq")
  }

  def asString(c: Comparator): String = c match {
    case Gt  => "gt"
    case Gte => "gte"
    case Lt  => "lt"
    case Lte => "lte"
    case Eq  => "eq"
    case Neq => "neq"
  }
}

/** Durable alert rule definition. Storage-only (HEL-447) — evaluation
 *  (HEL-455) and event/state persistence (HEL-466) are later tickets in the
 *  chain. `condition` is opaque `jsonb` (comparator + threshold + optional
 *  window params) so richer condition kinds can be added without a
 *  migration; the service validates only the `comparator`/`threshold` keys
 *  on write and passes the rest through unchanged. */
final case class AlertRule(
    id: AlertRuleId,
    ownerId: UserId,
    targetDataTypeId: DataTypeId,
    metric: String,
    condition: JsValue,
    name: String,
    enabled: Boolean,
    severity: Severity,
    createdAt: Instant,
    updatedAt: Instant
)

/** HEL-414 — scheduled-runs data model foundation (no runtime firing here;
 *  that is the sibling poller ticket, HEL-415). Mirrors the `Severity` enum
 *  pattern. */
sealed trait ScheduleKind
object ScheduleKind {
  case object Cron     extends ScheduleKind
  case object Interval extends ScheduleKind

  def fromString(s: String): Either[String, ScheduleKind] = s match {
    case "cron"     => Right(Cron)
    case "interval" => Right(Interval)
    case other      => Left(s"Unknown schedule kind: '$other'. Valid values: cron, interval")
  }

  def asString(k: ScheduleKind): String = k match {
    case Cron     => "cron"
    case Interval => "interval"
  }
}

/** Durable per-pipeline schedule (cron or interval), at most one per
 *  pipeline. Storage-only (HEL-414) — `nextRunAt`/`lastRunAt` are persisted
 *  as nullable, caller-supplied fields but never computed here; that is
 *  HEL-415's poller. Owner-scoped indirectly via `pipelineId` (V62's RLS
 *  joins to `pipelines.owner_id`) — no `ownerId` field of its own, mirroring
 *  `pipeline_steps`/`pipeline_runs`. */
final case class PipelineSchedule(
    id: PipelineScheduleId,
    pipelineId: PipelineId,
    kind: ScheduleKind,
    expression: String,
    enabled: Boolean,
    timezone: String,
    nextRunAt: Option[Instant],
    lastRunAt: Option[Instant],
    createdAt: Instant,
    updatedAt: Instant
)

final case class AlertEventId(value: String) extends AnyVal

/** Lifecycle state of an [[AlertEvent]] — see `AlertEventStateMachine` for the
 *  single source of truth on legal transitions between these values. */
sealed trait AlertEventState
object AlertEventState {
  case object Firing       extends AlertEventState
  case object Resolved     extends AlertEventState
  case object Acknowledged extends AlertEventState
  case object Snoozed      extends AlertEventState

  def fromString(s: String): Either[String, AlertEventState] = s match {
    case "firing"       => Right(Firing)
    case "resolved"     => Right(Resolved)
    case "acknowledged" => Right(Acknowledged)
    case "snoozed"       => Right(Snoozed)
    case other          => Left(s"Unknown alert event state: '$other'. Valid values: firing, resolved, acknowledged, snoozed")
  }

  def asString(s: AlertEventState): String = s match {
    case Firing       => "firing"
    case Resolved     => "resolved"
    case Acknowledged => "acknowledged"
    case Snoozed      => "snoozed"
  }
}

/** Closed set of actions accepted by `AlertEventStateMachine.transition`.
 *  `ReFire` models a breach re-observed against an event that is already
 *  active (not `resolved`) — see design.md's "ReFire is legal from every
 *  active state" decision for the full rationale on each of its four
 *  branches (`firing`/`acknowledged`/unexpired-`snoozed` refresh in place;
 *  expired-`snoozed` additionally flips to `firing`). */
sealed trait AlertEventAction
object AlertEventAction {
  case object Acknowledge                                                              extends AlertEventAction
  final case class Snooze(until: Instant)                                              extends AlertEventAction
  case object Resolve                                                                  extends AlertEventAction
  final case class ReFire(value: JsValue, severity: Severity, pipelineRunId: Option[String]) extends AlertEventAction
}

/** Durable, de-duplicated alert event (HEL-455). At most one *active*
 *  (non-resolved) event exists per `alertRuleId` at any time — see
 *  `AlertEventRepository.upsertFiringInternal` for the dedup/upsert path and
 *  `AlertEventStateMachine` for the single-source-of-truth transition
 *  function every mutation (user-driven or engine-driven) goes through.
 *  `ownerId`/`targetDataTypeId` are denormalized from the parent `AlertRule`
 *  at creation (design.md Decision: "Table shape"). `pipelineRunId` is
 *  unenforced (no FK) — pipeline runs are ephemeral execution records. */
final case class AlertEvent(
    id: AlertEventId,
    alertRuleId: AlertRuleId,
    ownerId: UserId,
    targetDataTypeId: DataTypeId,
    value: JsValue,
    pipelineRunId: Option[String],
    severity: Severity,
    state: AlertEventState,
    firstFiredAt: Instant,
    lastEvaluatedAt: Instant,
    resolvedAt: Option[Instant],
    acknowledgedAt: Option[Instant],
    snoozedUntil: Option[Instant]
)
