package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, MetricId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[MetricPanel]]. Carries the data-type binding plus
 *  the field mapping — both are required at the schema level for a panel
 *  to render data, but cycle-1 read-path tolerance defaults to empty so a
 *  mid-edit row with `type_id IS NULL` does not 500 on listByDashboard.
 *
 *  `metricId` (HEL-500) optionally binds to a stored `MetricDefinition`
 *  instead of the raw trio: when set, it is the authoritative source of the
 *  effective `dataTypeId`/`fieldMapping`/`aggregation`/`unit` at read time
 *  (`PanelService.resolveBindingsForRead`/`resolveSingleBinding`, design.md
 *  D4) — the raw fields on this config, when present, always override their
 *  metric-derived counterpart.
 *
 *  `metricDeprecated` (HEL-560) is a read-only, server-materialized field:
 *  never decoded from client input (`decode`/`decodeCreate`/`Patch` all
 *  ignore it), always freshly recomputed by
 *  `PanelServiceHelpers.withMaterializedMetric` from the resolved metric's
 *  current `deprecated` flag whenever `metricId` resolves to an owned
 *  `MetricDefinition` — absent (not `false`) otherwise. */
final case class MetricPanelConfig(
    dataTypeId: DataTypeId,
    fieldMapping: JsObject,
    aggregation: Option[JsObject] = None,
    label: Option[String] = None,
    unit: Option[String] = None,
    metricId: Option[MetricId] = None,
    metricDeprecated: Option[Boolean] = None
)

object MetricPanelConfig {
  val Empty: MetricPanelConfig = MetricPanelConfig(DataTypeId(""), JsObject.empty, None, None, None, None)

  implicit val format: RootJsonFormat[MetricPanelConfig] = jsonFormat7(MetricPanelConfig.apply)

  /** Tolerant JsValue decoder — missing/null fields default to empties
   *  so partial rows survive the read path (CS2c-3a cycle-2 lesson). */
  def decode(json: JsValue): MetricPanelConfig = json match {
    case JsObject(fields) =>
      val dataTypeId = fields.get("dataTypeId") match {
        case Some(JsString(s)) => DataTypeId(s)
        case _                 => DataTypeId("")
      }
      val mapping = fields.get("fieldMapping") match {
        case Some(o: JsObject) => o
        case _                 => JsObject.empty
      }
      val aggregation = fields.get("aggregation") match {
        case Some(o: JsObject) => Some(o)
        case _                 => None
      }
      val label = fields.get("label") match {
        case Some(JsString(s)) => Some(s)
        case _                 => None
      }
      val unit = fields.get("unit") match {
        case Some(JsString(s)) => Some(s)
        case _                 => None
      }
      val metricId = fields.get("metricId") match {
        case Some(JsString(s)) => Some(MetricId(s))
        case _                 => None
      }
      MetricPanelConfig(dataTypeId, mapping, aggregation, label, unit, metricId)
    case _ => Empty
  }

  /** Create-side decoder: tolerant; `decode("{}")` returns [[Empty]]. */
  def decodeCreate(json: JsValue): MetricPanelConfig = decode(json)

  /** Update-side patch carrying absent-vs-null per field
   *  (outer `None` = absent; `Some(None)` = explicit null/clear;
   *  `Some(Some(v))` = set). */
  final case class Patch(
      dataTypeId: Option[Option[DataTypeId]],
      fieldMapping: Option[Option[JsObject]],
      aggregation: Option[Option[JsObject]],
      label: Option[Option[String]] = None,
      unit: Option[Option[String]] = None,
      metricId: Option[Option[MetricId]] = None
  ) {
    def isEmpty: Boolean =
      dataTypeId.isEmpty && fieldMapping.isEmpty && aggregation.isEmpty && label.isEmpty && unit.isEmpty && metricId.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None, None, None, None)

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
        val aggregation = fields.get("aggregation") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(o))
          case Some(x)           => deserializationError(s"aggregation must be an object or null, got $x")
        }
        val label = fields.get("label") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(s))
          case Some(x)           => deserializationError(s"label must be a string or null, got $x")
        }
        val unit = fields.get("unit") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(s))
          case Some(x)           => deserializationError(s"unit must be a string or null, got $x")
        }
        val metricId = fields.get("metricId") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(MetricId(s)))
          case Some(x)           => deserializationError(s"metricId must be a string or null, got $x")
        }
        Patch(typeId, mapping, aggregation, label, unit, metricId)
      case _ => Empty
    }
  }
}

/** Metric panel — a single-value (or small-grid) display bound to a
 *  DataType. Cycle-1 share-shape with [[ChartPanel]] and [[TablePanel]];
 *  per design.md §1 we keep them as distinct types rather than introduce
 *  a `BoundConfig` shared trait. */
final case class MetricPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: MetricPanelConfig
) extends Panel {
  val kind: String = MetricPanel.Kind

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

  def withBindingCleared: Panel = copy(config = MetricPanelConfig.Empty)

  /** Apply an update-side patch, preserving absent-vs-null semantics. */
  def applyPatch(patch: MetricPanelConfig.Patch): MetricPanel = copy(
    config = MetricPanelConfig(
      dataTypeId   = patch.dataTypeId.fold(config.dataTypeId)(_.getOrElse(DataTypeId(""))),
      fieldMapping = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty)),
      aggregation  = patch.aggregation.fold(config.aggregation)(identity),
      label        = patch.label.fold(config.label)(identity),
      unit         = patch.unit.fold(config.unit)(identity),
      metricId     = patch.metricId.fold(config.metricId)(identity)
    )
  )
}

object MetricPanel {
  val Kind: String = "metric"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = MetricPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[MetricPanelConfig].toJson
  }
}
