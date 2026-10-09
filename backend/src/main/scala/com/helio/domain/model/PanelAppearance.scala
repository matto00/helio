package com.helio.domain.model

import com.helio.api.http.RequestValidation
import org.slf4j.LoggerFactory
import spray.json._

final case class PanelAppearance(background: String, color: String, transparency: Double, chart: Option[ChartAppearance] = None)

object PanelAppearance {
  val Default: PanelAppearance = PanelAppearance(
    background = "transparent",
    color = "inherit",
    transparency = 0.0
  )

  private val log = LoggerFactory.getLogger(getClass)

  /** Update-side patch carrying absent-vs-null per top-level field, mirroring
   *  `ChartAppearance.Patch` (HEL-362). Merge is shallow at this level —
   *  `chart` delegates to its own field-level `ChartAppearance.Patch`. */
  final case class Patch(
      background: Option[Option[String]],
      color: Option[Option[String]],
      transparency: Option[Option[Double]],
      chart: Option[Option[ChartAppearance.Patch]]
  ) {
    def isEmpty: Boolean = background.isEmpty && color.isEmpty && transparency.isEmpty && chart.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None, None)

    // `background`/`color`/`transparency` route a *provided* value through the
    // same `RequestValidation.normalize*` calls the pre-HEL-362 full-replace
    // path used (trim + blank-collapses-to-Default for strings; clamp to
    // [0, 1] for transparency) so a full payload merges to an identical
    // result as today's replace (backward-compat acceptance criterion).
    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val background = fields.get("background") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(RequestValidation.normalizePanelBackground(Some(s))))
          case Some(x)            => deserializationError(s"background must be a string or null, got $x")
        }
        val color = fields.get("color") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) => Some(Some(RequestValidation.normalizePanelColor(Some(s))))
          case Some(x)            => deserializationError(s"color must be a string or null, got $x")
        }
        val transparency = fields.get("transparency") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsNumber(n)) => Some(Some(RequestValidation.normalizeTransparency(Some(n.toDouble))))
          case Some(x)            => deserializationError(s"transparency must be a number or null, got $x")
        }
        val chart = fields.get("chart") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(ChartAppearance.Patch.decode(o)))
          case Some(x)            => deserializationError(s"chart must be an object or null, got $x")
        }
        Patch(background, color, transparency, chart)
      case _ => Empty
    }
  }

  /** Merge a decoded patch over the stored `PanelAppearance`. `chart: null`
   *  clears the sub-object entirely (`None`); a provided `chart` patch merges
   *  field-by-field over the stored chart. When the panel has none, the base is
   *  `ChartAppearance.Default` with `chartType` absent (HEL-1304): a patch that
   *  does not name a chart type must not store `Default`'s `"line"`, which would
   *  then outrank the bound Output's `config.chartType` at render. An explicit
   *  `chartType` in the patch still sets it. */
  def applyPatch(patch: Patch, existing: PanelAppearance): PanelAppearance = PanelAppearance(
    background   = patch.background.fold(existing.background)(_.getOrElse(Default.background)),
    color        = patch.color.fold(existing.color)(_.getOrElse(Default.color)),
    transparency = patch.transparency.fold(existing.transparency)(_.getOrElse(Default.transparency)),
    chart = patch.chart.fold(existing.chart) {
      case None            => None
      case Some(chartPatch) =>
        Some(ChartAppearance.applyPatch(chartPatch, existing.chart.getOrElse(ChartAppearance.Default.copy(chartType = None))))
    }
  )

  /** Decode + merge a wire-shape appearance patch against the panel's stored
   *  appearance in one step, catching malformed shapes as a client-safe
   *  `Left`. `DeserializationException` messages are always curated/static
   *  text authored via `deserializationError(...)` above — never a wrapped
   *  raw exception — so they are safe to return to the client. Mirrors
   *  `PanelConfigCodec.safe`. */
  def applyPatchJson(json: JsValue, existing: PanelAppearance): Either[String, PanelAppearance] =
    try Right(applyPatch(Patch.decode(json), existing))
    catch {
      case d: DeserializationException => Left(d.getMessage)
      case e: Throwable =>
        log.error("appearance patch decode failed", e)
        Left("appearance patch decode failed")
    }
}
