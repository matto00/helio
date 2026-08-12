package com.helio.domain.panels

import com.helio.api.RequestValidation
import com.helio.domain.{DashboardId, DataTypeId, MetricId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[TablePanel]] — same shape as the other "bound trio"
 *  configs ([[MetricPanelConfig]] / [[ChartPanelConfig]]), plus per-panel table
 *  display state (`columnWidths`, `density`, `columnOrder`).
 *
 *  `density` (`condensed` | `normal` | `spacious`) and `columnOrder` (ordered
 *  visible-column keys) follow the HEL-253 `columnWidths` pattern: optional,
 *  absent = defaults (normal density; all columns visible in natural order).
 *
 *  `metricId` (HEL-500) persists, validates, and cross-user-clears
 *  identically to [[MetricPanelConfig]]'s, but is NOT materialized into an
 *  effective `fieldMapping` here — a table's arbitrary column-key mapping has
 *  no unambiguous single slot a metric's one `measureField` should fill
 *  (design.md D4).
 *
 *  `metricDeprecated` (HEL-560) is read-only/server-materialized — same
 *  semantics as [[MetricPanelConfig.metricDeprecated]]. */
final case class TablePanelConfig(
    dataTypeId: DataTypeId,
    fieldMapping: JsObject,
    columnWidths: Map[String, Int] = Map.empty,
    density: Option[String] = None,
    columnOrder: Option[List[String]] = None,
    metricId: Option[MetricId] = None,
    metricDeprecated: Option[Boolean] = None
)

object TablePanelConfig {
  val Empty: TablePanelConfig = TablePanelConfig(DataTypeId(""), JsObject.empty, Map.empty, None, None, None)

  implicit val format: RootJsonFormat[TablePanelConfig] = jsonFormat7(TablePanelConfig.apply)

  def decode(json: JsValue): TablePanelConfig = json match {
    case JsObject(fields) =>
      val dataTypeId = fields.get("dataTypeId") match {
        case Some(JsString(s)) => DataTypeId(s)
        case _                 => DataTypeId("")
      }
      val mapping = fields.get("fieldMapping") match {
        case Some(o: JsObject) => o
        case _                 => JsObject.empty
      }
      val widths = fields.get("columnWidths") match {
        case Some(o: JsObject) => decodeColumnWidths(o)
        case _                 => Map.empty[String, Int]
      }
      // Lenient: a wrong-typed or unknown density is treated as absent, never
      // stored as-is (matches this decode path's tolerant philosophy).
      val density = fields.get("density") match {
        case Some(JsString(s)) if RequestValidation.ValidTableDensityValues.contains(s) => Some(s)
        case _                                                                          => None
      }
      val columnOrder = fields.get("columnOrder") match {
        case Some(JsArray(elems)) => Some(elems.collect { case JsString(s) => s }.toList)
        case _                    => None
      }
      val metricId = fields.get("metricId") match {
        case Some(JsString(s)) => Some(MetricId(s))
        case _                 => None
      }
      TablePanelConfig(dataTypeId, mapping, widths, density, columnOrder, metricId)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): TablePanelConfig = decode(json)

  private def decodeColumnWidths(obj: JsObject): Map[String, Int] =
    obj.fields.collect { case (key, JsNumber(n)) => key -> n.toInt }

  final case class Patch(
      dataTypeId: Option[Option[DataTypeId]],
      fieldMapping: Option[Option[JsObject]],
      columnWidths: Option[Option[Map[String, Int]]],
      density: Option[Option[String]],
      columnOrder: Option[Option[List[String]]],
      metricId: Option[Option[MetricId]] = None
  ) {
    def isEmpty: Boolean =
      dataTypeId.isEmpty && fieldMapping.isEmpty && columnWidths.isEmpty &&
        density.isEmpty && columnOrder.isEmpty && metricId.isEmpty
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
        val widths = fields.get("columnWidths") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(decodeColumnWidths(o)))
          case Some(x)           => deserializationError(s"columnWidths must be an object or null, got $x")
        }
        // Invalid density on the PATCH path is a hard 400 (imageFit precedent):
        // reject unknown values rather than silently dropping them.
        val density = fields.get("density") match {
          case None         => None
          case Some(JsNull) => Some(None)
          case Some(JsString(s)) =>
            RequestValidation.validateTableDensity(Some(s)) match {
              case Right(_)  => Some(Some(s))
              case Left(err) => deserializationError(err)
            }
          case Some(x) => deserializationError(s"density must be a string or null, got $x")
        }
        val columnOrder = fields.get("columnOrder") match {
          case None                 => None
          case Some(JsNull)         => Some(None)
          case Some(JsArray(elems)) =>
            Some(Some(elems.map {
              case JsString(s) => s
              case x           => deserializationError(s"columnOrder entries must be strings, got $x")
            }.toList))
          case Some(x) => deserializationError(s"columnOrder must be an array or null, got $x")
        }
        val metricId = fields.get("metricId") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(MetricId(s)))
          case Some(x)           => deserializationError(s"metricId must be a string or null, got $x")
        }
        Patch(typeId, mapping, widths, density, columnOrder, metricId)
      case _ => Empty
    }
  }
}

final case class TablePanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: TablePanelConfig
) extends Panel {
  val kind: String = TablePanel.Kind

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

  def withBindingCleared: Panel = copy(config = TablePanelConfig.Empty)

  def applyPatch(patch: TablePanelConfig.Patch): TablePanel = copy(
    config = TablePanelConfig(
      dataTypeId   = patch.dataTypeId.fold(config.dataTypeId)(_.getOrElse(DataTypeId(""))),
      fieldMapping = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty)),
      columnWidths = patch.columnWidths.fold(config.columnWidths)(_.getOrElse(Map.empty)),
      density      = patch.density.fold(config.density)(identity),
      columnOrder  = patch.columnOrder.fold(config.columnOrder)(identity),
      metricId     = patch.metricId.fold(config.metricId)(identity)
    )
  )
}

object TablePanel {
  val Kind: String = "table"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = TablePanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[TablePanelConfig].toJson
  }
}
