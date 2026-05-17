package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[TextPanel]] — unbound content panel. */
final case class TextPanelConfig(content: String)

object TextPanelConfig {
  val Empty: TextPanelConfig = TextPanelConfig("")

  implicit val format: RootJsonFormat[TextPanelConfig] = jsonFormat1(TextPanelConfig.apply)

  def decode(json: JsValue): TextPanelConfig = json match {
    case JsObject(fields) =>
      val content = fields.get("content") match {
        case Some(JsString(s)) => s
        case _                 => ""
      }
      TextPanelConfig(content)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): TextPanelConfig = decode(json)

  /** Update patch — `content` has no clear-to-null semantic (the column
   *  defaults to empty string on the wire). Absent leaves unchanged. */
  final case class Patch(content: Option[String]) {
    def isEmpty: Boolean = content.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val content = fields.get("content") match {
          case None              => None
          case Some(JsNull)      => Some("")
          case Some(JsString(s)) => Some(s)
          case Some(x)           => deserializationError(s"content must be a string or null, got $x")
        }
        Patch(content)
      case _ => Empty
    }
  }
}

final case class TextPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: TextPanelConfig
) extends Panel {
  val kind: String                    = TextPanel.Kind
  def dataTypeId: Option[DataTypeId]  = None
  def fieldMapping: Option[JsValue]   = None
  def validateConfig: Either[String, Unit] = Right(())
  def buildQuery: Option[PanelQuery]  = None
  def withBindingCleared: Panel       = this

  def applyPatch(patch: TextPanelConfig.Patch): TextPanel = copy(
    config = TextPanelConfig(content = patch.content.getOrElse(config.content))
  )
}

object TextPanel {
  val Kind: String = "text"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = TextPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[TextPanelConfig].toJson
  }
}
