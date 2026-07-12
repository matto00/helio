package com.helio.domain.panels

import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for a [[TextPanel]] — content is either literal (Static
 *  mode) or resolved from a bound DataType field (Source mode) via
 *  `fieldMapping.content`, mirroring [[MetricPanelConfig]]'s shape. */
final case class TextPanelConfig(
    content: String,
    dataTypeId: DataTypeId = DataTypeId(""),
    fieldMapping: JsObject = JsObject.empty
)

object TextPanelConfig {
  val Empty: TextPanelConfig = TextPanelConfig("", DataTypeId(""), JsObject.empty)

  implicit val format: RootJsonFormat[TextPanelConfig] = jsonFormat3(TextPanelConfig.apply)

  /** Tolerant JsValue decoder — missing/null fields default to empties
   *  so partial rows survive the read path (mirrors MetricPanelConfig.decode). */
  def decode(json: JsValue): TextPanelConfig = json match {
    case JsObject(fields) =>
      val content = fields.get("content") match {
        case Some(JsString(s)) => s
        case _                 => ""
      }
      val dataTypeId = fields.get("dataTypeId") match {
        case Some(JsString(s)) => DataTypeId(s)
        case _                 => DataTypeId("")
      }
      val mapping = fields.get("fieldMapping") match {
        case Some(o: JsObject) => o
        case _                 => JsObject.empty
      }
      TextPanelConfig(content, dataTypeId, mapping)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): TextPanelConfig = decode(json)

  /** Update patch — `content` keeps its existing "no clear-to-null"
   *  semantic (absent leaves unchanged; `JsNull` -> ""). `dataTypeId`/
   *  `fieldMapping` use the absent-vs-null convention (mirroring
   *  MetricPanelConfig.Patch) so an explicit `null` clears the binding
   *  independently of `content`. */
  final case class Patch(
      content: Option[String],
      dataTypeId: Option[Option[DataTypeId]] = None,
      fieldMapping: Option[Option[JsObject]] = None
  ) {
    def isEmpty: Boolean = content.isEmpty && dataTypeId.isEmpty && fieldMapping.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val content = fields.get("content") match {
          case None              => None
          case Some(JsNull)      => Some("")
          case Some(JsString(s)) => Some(s)
          case Some(x)           => deserializationError(s"content must be a string or null, got $x")
        }
        val dataTypeId = fields.get("dataTypeId") match {
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
        Patch(content, dataTypeId, mapping)
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

  /** Clears only the binding, preserving literal `content` — deliberately
   *  diverges from MetricPanel.withBindingCleared (which resets to
   *  MetricPanelConfig.Empty, wiping label/unit too). Text's `content` is
   *  the Static-mode payload itself, not a binding-context display
   *  override; wiping it on a binding scrub would be data loss. */
  def withBindingCleared: Panel = copy(
    config = config.copy(dataTypeId = DataTypeId(""), fieldMapping = JsObject.empty)
  )

  def applyPatch(patch: TextPanelConfig.Patch): TextPanel = copy(
    config = TextPanelConfig(
      content      = patch.content.getOrElse(config.content),
      dataTypeId   = patch.dataTypeId.fold(config.dataTypeId)(_.getOrElse(DataTypeId(""))),
      fieldMapping = patch.fieldMapping.fold(config.fieldMapping)(_.getOrElse(JsObject.empty))
    )
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
