package com.helio.domain.model

import com.helio.api.http.RequestValidation
import spray.json._

final case class ChartLegend(show: Boolean, position: String)
final case class ChartTooltip(enabled: Boolean)
final case class ChartAxisLabel(show: Boolean, label: Option[String])
final case class ChartAxisLabels(x: ChartAxisLabel, y: ChartAxisLabel)
final case class ChartAppearance(
    seriesColors: Vector[String],
    legend: ChartLegend,
    tooltip: ChartTooltip,
    axisLabels: ChartAxisLabels,
    chartType: Option[String] = None
)

object ChartAppearance {
  /** Mirrors the frontend's `DEFAULT_CHART_APPEARANCE`
   *  (`PanelDetailModal.tsx`) so a proposal-created chart and a manually-
   *  edited one converge on the same look. Used as the base a proposal's
   *  chart-appearance fields (Decision 2/HEL-293) override field-by-field.
   *  `chartType = Some("line")` here is the proposal-created/full-default look
   *  only; `PanelAppearance.applyPatch` merges a chartless panel's chart patch
   *  over `Default.copy(chartType = None)` so a patch never invents it. */
  val Default: ChartAppearance = ChartAppearance(
    seriesColors = Vector(
      "#5470c6", "#91cc75", "#fac858", "#ee6666",
      "#73c0de", "#3ba272", "#fc8452", "#9a60b4"
    ),
    legend  = ChartLegend(show = true, position = "top"),
    tooltip = ChartTooltip(enabled = true),
    axisLabels = ChartAxisLabels(
      // Beta UI-audit F-095: an unconfigured chart shouldn't render a literal placeholder axis
      // title. Mirrors frontend/src/theme/appearance.ts's defaultChartAppearance.
      x = ChartAxisLabel(show = true, label = Some("")),
      y = ChartAxisLabel(show = true, label = Some(""))
    ),
    chartType = Some("line")
  )

  /** Update-side patch carrying absent-vs-null per field (outer `None` =
   *  absent/keep, `Some(None)` = explicit null/clear, `Some(Some(v))` = set)
   *  — the same idiom as `MetricPanelConfig.Patch` (HEL-362).
   *
   *  `chartType` is the one field-level exception to "null resets to
   *  `Default`": `chartType: null` clears to `None` (matching today's
   *  absent-chartType-renders-as-line fallback), never
   *  `Default.chartType` (`"line"`) — see `applyPatch`. */
  final case class Patch(
      seriesColors: Option[Option[Vector[String]]],
      legend: Option[Option[ChartLegend]],
      tooltip: Option[Option[ChartTooltip]],
      axisLabels: Option[Option[ChartAxisLabels]],
      chartType: Option[Option[String]]
  ) {
    def isEmpty: Boolean =
      seriesColors.isEmpty && legend.isEmpty && tooltip.isEmpty && axisLabels.isEmpty && chartType.isEmpty
  }

  object Patch {
    val Empty: Patch = Patch(None, None, None, None, None)

    /** Each provided field replaces the stored value wholesale (no merge
     *  inside `legend`/`tooltip`/`axisLabels` themselves — HEL-362 design.md
     *  Non-Goals). `chartType` is validated against the allowed set
     *  (`RequestValidation.validateChartType`) at decode time, mirroring
     *  `DividerPanelConfig.Patch.decode`'s `orientation` validation. */
    def decode(json: JsValue): Patch = json match {
      case JsObject(fields) =>
        val seriesColors = fields.get("seriesColors") match {
          case None                 => None
          case Some(JsNull)         => Some(None)
          case Some(JsArray(elems)) => Some(Some(elems.map(decodeColor)))
          case Some(x)               => deserializationError(s"seriesColors must be an array of strings or null, got $x")
        }
        val legend = fields.get("legend") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(decodeLegend(o)))
          case Some(x)            => deserializationError(s"legend must be an object or null, got $x")
        }
        val tooltip = fields.get("tooltip") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(decodeTooltip(o)))
          case Some(x)            => deserializationError(s"tooltip must be an object or null, got $x")
        }
        val axisLabels = fields.get("axisLabels") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(o: JsObject) => Some(Some(decodeAxisLabels(o)))
          case Some(x)            => deserializationError(s"axisLabels must be an object or null, got $x")
        }
        val chartType = fields.get("chartType") match {
          case None              => None
          case Some(JsNull)      => Some(None)
          case Some(JsString(s)) =>
            RequestValidation.validateChartType(Some(s)) match {
              case Right(_)  => Some(Some(s))
              case Left(err) => deserializationError(err)
            }
          case Some(x) => deserializationError(s"chartType must be a string or null, got $x")
        }
        Patch(seriesColors, legend, tooltip, axisLabels, chartType)
      case _ => Empty
    }

    private def decodeColor(json: JsValue): String = json match {
      case JsString(s) => s
      case x            => deserializationError(s"seriesColors elements must be strings, got $x")
    }

    private def decodeLegend(obj: JsObject): ChartLegend = {
      val show = obj.fields.get("show") match {
        case Some(JsBoolean(b)) => b
        case other              => deserializationError(s"legend.show must be a boolean, got ${other.getOrElse(JsNull)}")
      }
      val position = obj.fields.get("position") match {
        case Some(JsString(s)) => s
        case other              => deserializationError(s"legend.position must be a string, got ${other.getOrElse(JsNull)}")
      }
      ChartLegend(show, position)
    }

    private def decodeTooltip(obj: JsObject): ChartTooltip = {
      val enabled = obj.fields.get("enabled") match {
        case Some(JsBoolean(b)) => b
        case other              => deserializationError(s"tooltip.enabled must be a boolean, got ${other.getOrElse(JsNull)}")
      }
      ChartTooltip(enabled)
    }

    private def decodeAxisLabel(obj: JsObject, axis: String): ChartAxisLabel = {
      val show = obj.fields.get("show") match {
        case Some(JsBoolean(b)) => b
        case other              => deserializationError(s"axisLabels.$axis.show must be a boolean, got ${other.getOrElse(JsNull)}")
      }
      val label = obj.fields.get("label") match {
        case None | Some(JsNull) => None
        case Some(JsString(s))   => Some(s)
        case Some(x)              => deserializationError(s"axisLabels.$axis.label must be a string or null, got $x")
      }
      ChartAxisLabel(show, label)
    }

    private def decodeAxisLabels(obj: JsObject): ChartAxisLabels = {
      val x = obj.fields.get("x") match {
        case Some(o: JsObject) => decodeAxisLabel(o, "x")
        case other              => deserializationError(s"axisLabels.x must be an object, got ${other.getOrElse(JsNull)}")
      }
      val y = obj.fields.get("y") match {
        case Some(o: JsObject) => decodeAxisLabel(o, "y")
        case other              => deserializationError(s"axisLabels.y must be an object, got ${other.getOrElse(JsNull)}")
      }
      ChartAxisLabels(x, y)
    }
  }

  /** Merge a decoded patch over the stored `ChartAppearance` — absent keeps
   *  `existing`, explicit null resets to `Default`'s field, provided sets.
   *  `chartType` alone breaks that null-resets-to-`Default` rule: `identity`
   *  passes `Some(None)` straight through to `None` rather than falling back
   *  to `Default.chartType`. */
  def applyPatch(patch: Patch, existing: ChartAppearance): ChartAppearance = ChartAppearance(
    seriesColors = patch.seriesColors.fold(existing.seriesColors)(_.getOrElse(Default.seriesColors)),
    legend       = patch.legend.fold(existing.legend)(_.getOrElse(Default.legend)),
    tooltip      = patch.tooltip.fold(existing.tooltip)(_.getOrElse(Default.tooltip)),
    axisLabels   = patch.axisLabels.fold(existing.axisLabels)(_.getOrElse(Default.axisLabels)),
    chartType    = patch.chartType.fold(existing.chartType)(identity)
  )
}
