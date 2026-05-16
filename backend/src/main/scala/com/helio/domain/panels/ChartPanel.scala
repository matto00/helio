package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[ChartPanel]].
 *
 *  Identical shape to [[MetricPanelConfig]] / [[TablePanelConfig]] today (the
 *  "bound trio" all carry `dataTypeId + fieldMapping`). Cycle-1 keeps each as a
 *  distinct type per design.md §1's user preference for strict per-type; if
 *  the trio diverges in a future cycle the per-file structure is unaffected.
 *
 *  Chart-specific appearance (`seriesColors`, axis labels, legend, etc.)
 *  lives on the common [[PanelAppearance]] `chart: Option[ChartAppearance]`
 *  per design.md §11 — moving it into `ChartPanelConfig` is out of scope
 *  for CS2c-3b and tracked as a CS3-era spinoff. */
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
