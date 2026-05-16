package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[ChartPanel]]. Same shape as the other "bound trio"
 *  configs ([[MetricPanelConfig]] / [[TablePanelConfig]]) — they are kept
 *  as distinct types per design.md §1 so future divergence is structural. */
final case class ChartPanelConfig(
    dataTypeId: DataTypeId,
    fieldMapping: JsObject
)

object ChartPanelConfig {
  val Empty: ChartPanelConfig = ChartPanelConfig(DataTypeId(""), JsObject.empty)

  implicit val format: RootJsonFormat[ChartPanelConfig] = jsonFormat2(ChartPanelConfig.apply)

  def decode(json: JsValue): ChartPanelConfig = json match {
    case JsObject(fields) =>
      val dataTypeId = fields.get("dataTypeId") match {
        case Some(JsString(s)) => DataTypeId(s)
        case _                 => DataTypeId("")
      }
      val mapping = fields.get("fieldMapping") match {
        case Some(o: JsObject) => o
        case _                 => JsObject.empty
      }
      ChartPanelConfig(dataTypeId, mapping)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): ChartPanelConfig = decode(json)

  final case class Patch(
      dataTypeId: Option[Option[DataTypeId]],
      fieldMapping: Option[Option[JsObject]]
  ) {
    def isEmpty: Boolean = dataTypeId.isEmpty && fieldMapping.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None)

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
        Patch(typeId, mapping)
      case _ => Empty
    }
  }
}

final case class ChartPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: ChartPanelConfig
) extends Panel {
  val kind: String = ChartPanel.Kind

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

  def withBindingCleared: Panel = copy(config = ChartPanelConfig.Empty)

  def applyPatch(patch: ChartPanelConfig.Patch): ChartPanel = copy(
    config = ChartPanelConfig(
      dataTypeId   = patch.dataTypeId.fold(config.dataTypeId)(_.getOrElse(DataTypeId(""))),
      fieldMapping = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty))
    )
  )
}

object ChartPanel {
  val Kind: String = "chart"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = ChartPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[ChartPanelConfig].toJson
  }
}
