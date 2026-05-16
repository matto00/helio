package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[DividerPanel]] — unbound structural separator.
 *  `weight` and `color` are optional (matching the nullable DB columns); only
 *  `orientation` carries a value-required invariant. */
final case class DividerPanelConfig(
    orientation: String,
    weight: Option[Int],
    color: Option[String]
)

object DividerPanelConfig {
  val DefaultOrientation: String = "horizontal"
  val Empty: DividerPanelConfig  = DividerPanelConfig(DefaultOrientation, None, None)

  implicit val format: RootJsonFormat[DividerPanelConfig] = jsonFormat3(DividerPanelConfig.apply)

  def decode(json: JsValue): DividerPanelConfig = json match {
    case JsObject(fields) =>
      val orientation = fields.get("orientation") match {
        case Some(JsString(s)) => s
        case _                 => DefaultOrientation
      }
      val weight = fields.get("weight") match {
        case Some(JsNumber(n)) => Some(n.toInt)
        case _                 => None
      }
      val color = fields.get("color") match {
        case Some(JsString(s)) => Some(s)
        case _                 => None
      }
      DividerPanelConfig(orientation, weight, color)
    case _ => Empty
  }
}

final case class DividerPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: DividerPanelConfig
) extends Panel {
  val kind: String                    = DividerPanel.Kind
  def dataTypeId: Option[DataTypeId]  = None
  def fieldMapping: Option[JsValue]   = None

  def validateConfig: Either[String, Unit] =
    config.weight match {
      case Some(w) if w <= 0 => Left("divider weight must be positive")
      case _                 => Right(())
    }

  def buildQuery: Option[PanelQuery] = None
  def withBindingCleared: Panel      = this
}

object DividerPanel {
  val Kind: String = "divider"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = DividerPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[DividerPanelConfig].toJson
  }
}
