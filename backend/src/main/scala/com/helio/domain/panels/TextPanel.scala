package com.helio.domain.panels

import com.helio.domain.model.{DashboardId, Panel, PanelAppearance, PanelId, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[TextPanel]] — literal, dashboard-native content.
 *  HEL-904 task 4.1: `dataTypeId`/`fieldMapping` (the data-bound "Source
 *  mode" of a text panel) are removed outright — the V94 migration already
 *  converted every data-bound text panel into a `markdown`-kind Output +
 *  `OutputPanel` placement (design.md line 76/103), so no live `text`-kind
 *  panel carries a binding anymore. A literal `TextPanel` only ever had
 *  `content`. */
final case class TextPanelConfig(content: String)

object TextPanelConfig {
  val Empty: TextPanelConfig = TextPanelConfig("")

  implicit val format: RootJsonFormat[TextPanelConfig] = jsonFormat1(TextPanelConfig.apply)

  /** Tolerant JsValue decoder — missing/null fields default to empties
   *  so partial rows survive the read path. */
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

  /** Update patch — `content` keeps its existing "no clear-to-null"
   *  semantic (absent leaves unchanged; `JsNull` -> ""). */
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
  val kind: String = TextPanel.Kind

  def validateConfig: Either[String, Unit] = Right(())

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
