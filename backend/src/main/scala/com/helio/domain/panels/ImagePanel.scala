package com.helio.domain.panels

import com.helio.api.RequestValidation
import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for an [[ImagePanel]] — unbound content panel rendering a
 *  remote image with a fit mode. */
final case class ImagePanelConfig(imageUrl: String, imageFit: String)

object ImagePanelConfig {
  /** Default `imageFit` matches the pre-CS2c-3b behaviour and the value
   *  `RequestValidation.validateImageFit` accepts. */
  val DefaultFit: String = "contain"
  val Empty: ImagePanelConfig = ImagePanelConfig("", DefaultFit)

  implicit val format: RootJsonFormat[ImagePanelConfig] = jsonFormat2(ImagePanelConfig.apply)

  def decode(json: JsValue): ImagePanelConfig = json match {
    case JsObject(fields) =>
      val imageUrl = fields.get("imageUrl") match {
        case Some(JsString(s)) => s
        case _                 => ""
      }
      val imageFit = fields.get("imageFit") match {
        case Some(JsString(s)) => s
        case _                 => DefaultFit
      }
      ImagePanelConfig(imageUrl, imageFit)
    case _ => Empty
  }

  def decodeCreate(json: JsValue): ImagePanelConfig = decode(json)

  /** Update patch — `imageFit` is validated against the allow-list at
   *  decode time to surface 400s before reaching the service. */
  final case class Patch(imageUrl: Option[String], imageFit: Option[String]) {
    def isEmpty: Boolean = imageUrl.isEmpty && imageFit.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None)

    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val url = fields.get("imageUrl") match {
          case None              => None
          case Some(JsNull)      => Some("")
          case Some(JsString(s)) => Some(s)
          case Some(x)           => deserializationError(s"imageUrl must be a string or null, got $x")
        }
        val fit = fields.get("imageFit") match {
          case None              => None
          case Some(JsNull)      => Some(DefaultFit)
          case Some(JsString(s)) =>
            RequestValidation.validateImageFit(Some(s)) match {
              case Right(_)  => Some(s)
              case Left(err) => deserializationError(err)
            }
          case Some(x)           => deserializationError(s"imageFit must be a string or null, got $x")
        }
        Patch(url, fit)
      case _ => Empty
    }
  }
}

final case class ImagePanel(
    id: PanelId,
    dashboardId: DashboardId,
    title: String,
    meta: ResourceMeta,
    appearance: PanelAppearance,
    ownerId: UserId,
    config: ImagePanelConfig
) extends Panel {
  val kind: String                    = ImagePanel.Kind
  def dataTypeId: Option[DataTypeId]  = None
  def fieldMapping: Option[JsValue]   = None

  def validateConfig: Either[String, Unit] = Right(())

  def buildQuery: Option[PanelQuery] = None
  def withBindingCleared: Panel      = this

  def applyPatch(patch: ImagePanelConfig.Patch): ImagePanel = copy(
    config = ImagePanelConfig(
      imageUrl = patch.imageUrl.getOrElse(config.imageUrl),
      imageFit = patch.imageFit.getOrElse(config.imageFit)
    )
  )
}

object ImagePanel {
  val Kind: String = "image"

  val companion: Panel.Companion = new Panel.Companion {
    val kind: String                          = Kind
    def readConfigFromWire(json: JsValue): Any = ImagePanelConfig.decode(json)
    def writeConfigToWire(config: Any): JsValue =
      config.asInstanceOf[ImagePanelConfig].toJson
  }
}
