package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[TablePanel]] — same shape as the other "bound trio"
 *  configs ([[MetricPanelConfig]] / [[ChartPanelConfig]]). */
final case class TablePanelConfig(
    dataTypeId: DataTypeId,
    fieldMapping: JsObject
)

object TablePanelConfig {
  val Empty: TablePanelConfig = TablePanelConfig(DataTypeId(""), JsObject.empty)

  implicit val format: RootJsonFormat[TablePanelConfig] = jsonFormat2(TablePanelConfig.apply)

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
      TablePanelConfig(dataTypeId, mapping)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): TablePanelConfig = decode(json)

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
      fieldMapping = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty))
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
