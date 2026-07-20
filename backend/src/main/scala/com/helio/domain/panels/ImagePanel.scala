package com.helio.domain.panels

import com.helio.api.RequestValidation
import com.helio.domain.{DashboardId, DataTypeId, Panel, PanelAppearance, PanelId, PanelQuery, ResourceMeta, UserId}
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Typed config for an [[ImagePanel]] — unbound content panel rendering a
 *  remote image with a fit mode.
 *
 *  `caption` (HEL-318) is optional static literal text rendered as a strip
 *  beneath the image; `None` (unset) is omitted from the wire `config` by
 *  `DefaultJsonProtocol`, never emitted as `null`. */
final case class ImagePanelConfig(imageUrl: String, imageFit: String, caption: Option[String] = None)

object ImagePanelConfig {
  /** Default `imageFit` matches the pre-CS2c-3b behaviour and the value
   *  `RequestValidation.validateImageFit` accepts. */
  val DefaultFit: String = "contain"
  val Empty: ImagePanelConfig = ImagePanelConfig("", DefaultFit, None)

  implicit val format: RootJsonFormat[ImagePanelConfig] = jsonFormat3(ImagePanelConfig.apply)

  /** Normalize a caption input to the cleared/set state: absent, null, empty,
   *  and whitespace-only all collapse to `None` so a blank caption round-trips
   *  as an omitted field, never a stored `""`. */
  private def normalizeCaption(value: Option[JsValue]): Option[String] = value match {
    case Some(JsString(s)) if s.trim.nonEmpty => Some(s)
    case _                                    => None
  }

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
      ImagePanelConfig(imageUrl, imageFit, normalizeCaption(fields.get("caption")))
    case _ => Empty
  }

  def decodeCreate(json: JsValue): ImagePanelConfig = decode(json)

  /** Update patch — `imageFit` is validated against the allow-list at
   *  decode time to surface 400s before reaching the service. `caption` is a
   *  two-level patch (`Option[Option[String]]`): absent = leave unchanged;
   *  null/empty/whitespace = clear; non-blank = set — mirroring
   *  `ChartPanelConfig.Patch.aggregation`, not the single-level `imageUrl`. */
  final case class Patch(
      imageUrl: Option[String],
      imageFit: Option[String],
      caption: Option[Option[String]]
  ) {
    def isEmpty: Boolean = imageUrl.isEmpty && imageFit.isEmpty && caption.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None)

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
        val caption = fields.get("caption") match {
          case None                                 => None
          case Some(JsNull)                         => Some(None)
          case Some(JsString(s)) if s.trim.nonEmpty => Some(Some(s))
          case Some(JsString(_))                    => Some(None)
          case Some(x)                              => deserializationError(s"caption must be a string or null, got $x")
        }
        Patch(url, fit, caption)
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
      imageFit = patch.imageFit.getOrElse(config.imageFit),
      caption  = patch.caption.fold(config.caption)(identity)
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
