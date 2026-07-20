package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

// ── Timeline-specific display options (HEL-317) ─────────────────────────────
//
// `timelineOptions` is a small closed shape — today just `sort` — modeled as
// its own top-level case class (mirroring the per-chart-type options classes
// in ChartPanel.scala) rather than a raw JsObject (unlike Collection's
// `itemOptions`, which is keyed per base type). Extensibility here is a
// code-only field addition.

final case class TimelineOptions(sort: String = TimelineOptions.DefaultSort)

object TimelineOptions {
  val DefaultSort: String = "asc"
  val ValidSorts: Set[String] = Set("asc", "desc")

  val Default: TimelineOptions = TimelineOptions(DefaultSort)

  implicit val format: RootJsonFormat[TimelineOptions] = jsonFormat1(TimelineOptions.apply)
}

/** Typed config for a [[TimelinePanel]] (HEL-317).
 *
 *  A Timeline renders the rows of a multi-row DataType as a vertical,
 *  chronological event list — one row of the bound snapshot = one entry, with
 *  the shared `fieldMapping` binding two slots (`time`, `event`) to columns.
 *  The binding reuses the existing `type_id` / `field_mapping` columns;
 *  timeline-only concerns (`sort`) persist in the dedicated
 *  `timeline_options` JSONB column (V58), mirroring the V57
 *  `collection_options` precedent one-for-one. */
final case class TimelinePanelConfig(
    dataTypeId: DataTypeId,
    fieldMapping: JsObject,
    timelineOptions: TimelineOptions = TimelineOptions.Default
)

object TimelinePanelConfig {
  val Empty: TimelinePanelConfig =
    TimelinePanelConfig(DataTypeId(""), JsObject.empty, TimelineOptions.Default)

  implicit val format: RootJsonFormat[TimelinePanelConfig] = jsonFormat3(TimelinePanelConfig.apply)

  private def sortField(fields: Map[String, JsValue], strict: Boolean): String =
    fields.get("sort") match {
      case Some(JsString(s)) if TimelineOptions.ValidSorts.contains(s) => s
      case Some(JsString(s)) =>
        if (strict) deserializationError(s"Invalid sort value: '$s'. Valid values: ${TimelineOptions.ValidSorts.toSeq.sorted.mkString(", ")}")
        else TimelineOptions.DefaultSort
      case Some(JsNull) | None => TimelineOptions.DefaultSort
      case Some(x)             => if (strict) deserializationError(s"sort must be a string, got $x") else TimelineOptions.DefaultSort
    }

  private def timelineOptionsField(fields: Map[String, JsValue], strict: Boolean): TimelineOptions =
    fields.get("timelineOptions") match {
      case Some(o: JsObject)   => TimelineOptions(sortField(o.fields, strict))
      case Some(JsNull) | None => TimelineOptions.Default
      case Some(x)             => if (strict) deserializationError(s"timelineOptions must be an object or null, got $x") else TimelineOptions.Default
    }

  private def decodeInternal(json: JsValue, strict: Boolean): TimelinePanelConfig = json match {
    case JsObject(fields) =>
      val dataTypeId = fields.get("dataTypeId") match {
        case Some(JsString(s)) => DataTypeId(s)
        case _                 => DataTypeId("")
      }
      val mapping = fields.get("fieldMapping") match {
        case Some(o: JsObject) => o
        case _                 => JsObject.empty
      }
      TimelinePanelConfig(
        dataTypeId      = dataTypeId,
        fieldMapping    = mapping,
        timelineOptions = timelineOptionsField(fields, strict)
      )
    case _ => Empty
  }

  /** Tolerant read (stored rows / responses) — absent/malformed fields default
   *  (`sort: "asc"`), never throws. */
  def decode(json: JsValue): TimelinePanelConfig = decodeInternal(json, strict = false)

  /** Create-path — an invalid `sort` enum raises a 400 (via `PanelConfigCodec`). */
  def decodeCreate(json: JsValue): TimelinePanelConfig = decodeInternal(json, strict = true)

  /** Update-side patch carrying absent-vs-null per field (outer `None` = absent;
   *  `Some(None)` = explicit null/clear; `Some(Some(v))` = set). */
  final case class Patch(
      dataTypeId: Option[Option[DataTypeId]],
      fieldMapping: Option[Option[JsObject]],
      timelineOptions: Option[Option[TimelineOptions]]
  ) {
    def isEmpty: Boolean = dataTypeId.isEmpty && fieldMapping.isEmpty && timelineOptions.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val typeId = fields.get("dataTypeId") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(DataTypeId(s)))
          case Some(x)           => deserializationError(s"dataTypeId must be a string or null, got $x")
        }
        val mapping = fields.get("fieldMapping") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(o))
          case Some(x)           => deserializationError(s"fieldMapping must be an object or null, got $x")
        }
        val timelineOptions = fields.get("timelineOptions") match {
          case None                 => None
          case Some(JsNull)         => Some(None)
          case Some(o: JsObject) if o.fields.isEmpty => Some(None)
          case Some(o: JsObject) =>
            Some(Some(TimelineOptions(sortField(o.fields, strict = true))))
          case Some(x) => deserializationError(s"timelineOptions must be an object or null, got $x")
        }
        Patch(typeId, mapping, timelineOptions)
      case _ => Empty
    }
  }
}

/** Timeline panel — a vertical chronological event list bound to a
 *  multi-row DataType (HEL-317). Shares the bound-trio binding surface
 *  (`dataTypeId` / `fieldMapping` / `buildQuery`); the row→entry expansion
 *  and ordering are a frontend rendering concern (`TimelineRenderer`). */
final case class TimelinePanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: TimelinePanelConfig
) extends Panel {
  val kind: String = TimelinePanel.Kind

  def dataTypeId: Option[DataTypeId] =
    if (config.dataTypeId.value.isEmpty) None else Some(config.dataTypeId)

  def fieldMapping: Option[JsValue] =
    if (config.fieldMapping.fields.isEmpty) None else Some(config.fieldMapping)

  def validateConfig: Either[String, Unit] = Right(())

  def buildQuery: Option[PanelQuery] =
    dataTypeId.map(_ => PanelQuery(
      selectedFields = Panel.selectedFieldsFromMapping(fieldMapping),
      filters        = List.empty,
      sort           = None,
      limit          = None
    ))

  def withBindingCleared: Panel = copy(config = TimelinePanelConfig.Empty)

  /** Apply an update-side patch, preserving absent-vs-null semantics. */
  def applyPatch(patch: TimelinePanelConfig.Patch): TimelinePanel = copy(
    config = TimelinePanelConfig(
      dataTypeId      = patch.dataTypeId.fold(config.dataTypeId)(_.getOrElse(DataTypeId(""))),
      fieldMapping    = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty)),
      timelineOptions = patch.timelineOptions.fold(config.timelineOptions)(_.getOrElse(TimelineOptions.Default))
    )
  )
}

object TimelinePanel {
  val Kind: String = "timeline"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = TimelinePanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[TimelinePanelConfig].toJson
  }
}
