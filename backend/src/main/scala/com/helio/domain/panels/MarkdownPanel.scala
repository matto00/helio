package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[MarkdownPanel]] — unbound content panel with
 *  Markdown-rendered body. Shape identical to [[TextPanelConfig]]. */
final case class MarkdownPanelConfig(content: String)

object MarkdownPanelConfig {
  val Empty: MarkdownPanelConfig = MarkdownPanelConfig("")

  implicit val format: RootJsonFormat[MarkdownPanelConfig] = jsonFormat1(MarkdownPanelConfig.apply)

  def decode(json: JsValue): MarkdownPanelConfig = json match {
    case JsObject(fields) =>
      val content = fields.get("content") match {
        case Some(JsString(s)) => s
        case _                 => ""
      }
      MarkdownPanelConfig(content)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): MarkdownPanelConfig = decode(json)

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

final case class MarkdownPanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: MarkdownPanelConfig
) extends Panel {
  val kind: String                    = MarkdownPanel.Kind
  def dataTypeId: Option[DataTypeId]  = None
  def fieldMapping: Option[JsValue]   = None
  def validateConfig: Either[String, Unit] = Right(())
  def buildQuery: Option[PanelQuery]  = None
  def withBindingCleared: Panel       = this

  def applyPatch(patch: MarkdownPanelConfig.Patch): MarkdownPanel = copy(
    config = MarkdownPanelConfig(content = patch.content.getOrElse(config.content))
  )
}

object MarkdownPanel {
  val Kind: String = "markdown"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = MarkdownPanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[MarkdownPanelConfig].toJson
  }
}
