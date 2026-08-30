package com.helio.domain.panels

import com.helio.domain.model.Panel
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Dispatcher between the wire-side `(type, config: JsValue)` shape and the
 *  per-subtype typed [[Panel]] / `*Config` / `*Config.Patch` ADTs.
 *
 *  This is the single source of truth for the CS2c-3c wire-shape collapse —
 *  every read (response) and write (create / update / batch) routes through
 *  one of these methods so the seven-subtype enumeration is centralised in
 *  one file. */
object PanelConfigCodec {

  private val log = LoggerFactory.getLogger(getClass)


  /** Encode a `Panel`'s typed config as the wire `config` field. The
   *  per-subtype `RootJsonFormat[*Config]` produced by `jsonFormatN` is the
   *  canonical writer; this method just narrows on the subtype. */
  def encodeConfig(panel: Panel): JsValue = panel match {
    case t:  TextPanel      => t.config.toJson
    case m:  MarkdownPanel  => m.config.toJson
    case i:  ImagePanel      => i.config.toJson
    case d:  DividerPanel    => d.config.toJson
    case op: OutputPanel     => op.config.toJson
    case other               => deserializationError(s"Unknown panel kind for encode: '${other.kind}'")
  }


  /** Sealed marker for a per-subtype `*Config` carried through the service
   *  layer at create time. Each variant wraps the typed config from one
   *  subtype's companion. */
  sealed trait CreateConfig
  final case class TextCreate(config: TextPanelConfig)         extends CreateConfig
  final case class MarkdownCreate(config: MarkdownPanelConfig) extends CreateConfig
  final case class ImageCreate(config: ImagePanelConfig)       extends CreateConfig
  final case class DividerCreate(config: DividerPanelConfig)   extends CreateConfig
  final case class OutputCreate(config: OutputPanelConfig)         extends CreateConfig

  /** Decode a create-side typed config from `(kind, config?)`. `decode(None)`
   *  yields the subtype's `Empty` config (codec read-path tolerance rule). */
  def decodeCreateConfig(kind: String, json: Option[JsValue]): Either[String, CreateConfig] = {
    val payload = json.getOrElse(JsObject.empty)
    kind match {
      case TextPanel.Kind     => safe(TextCreate(TextPanelConfig.decodeCreate(payload)))
      case MarkdownPanel.Kind => safe(MarkdownCreate(MarkdownPanelConfig.decodeCreate(payload)))
      case ImagePanel.Kind    => safe(ImageCreate(ImagePanelConfig.decodeCreate(payload)))
      case DividerPanel.Kind  => safe(DividerCreate(DividerPanelConfig.decodeCreate(payload)))
      case OutputPanel.Kind     => safe(OutputCreate(OutputPanelConfig.decodeCreate(payload)))
      case unknown            =>
        Left(s"Unknown panel type: '$unknown'. Valid values: ${Panel.Registry.keySet.toSeq.sorted.mkString(", ")}")
    }
  }


  /** Apply a wire-shape `(config: JsValue)` patch to the stored panel,
   *  preserving absent-vs-null semantics per the subtype's `Patch.decode`.
   *  Returns the resulting typed `Panel`. */
  def applyConfigPatch(existing: Panel, json: JsValue): Either[String, Panel] =
    safe(applyConfigPatchUnsafe(existing, json))

  private def applyConfigPatchUnsafe(existing: Panel, json: JsValue): Panel = existing match {
    case t:  TextPanel     => t.applyPatch(TextPanelConfig.Patch.decode(json))
    case m:  MarkdownPanel => m.applyPatch(MarkdownPanelConfig.Patch.decode(json))
    case i:  ImagePanel      => i.applyPatch(ImagePanelConfig.Patch.decode(json))
    case d:  DividerPanel    => d.applyPatch(DividerPanelConfig.Patch.decode(json))
    case op: OutputPanel     => op.applyPatch(OutputPanelConfig.Patch.decode(json))
    case other               => deserializationError(s"Unknown panel kind for patch: '${other.kind}'")
  }


  private def safe[A](thunk: => A): Either[String, A] =
    try Right(thunk)
    catch {
      // DeserializationException messages are always curated/static text
      // authored via `deserializationError(...)` in this package — never a
      // wrapped raw exception — so they are safe to return to the client.
      case d: DeserializationException => Left(d.getMessage)
      // Any other Throwable (e.g. a coding bug surfacing as NPE/ClassCastException)
      // is NOT curated and must not reach the client body (HEL-311).
      case e: Throwable =>
        log.error("config decode failed", e)
        Left("config decode failed")
    }
}
