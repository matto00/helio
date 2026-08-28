package com.helio.domain.model

import com.helio.domain.model.ChartAxisLabel
import com.helio.domain.model.{ChartAxisLabels, ChartLegend, ChartTooltip}
import com.helio.domain.model.{ChartAppearance, PanelAppearance}
import org.scalatest.OptionValues
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Unit coverage for the HEL-362 appearance partial-merge machinery —
 *  `PanelAppearance.Patch`/`applyPatch`/`applyPatchJson` and
 *  `ChartAppearance.Patch`/`applyPatch` — exercised directly against the
 *  domain layer (no HTTP/DB) so absent-vs-null semantics are pinned down
 *  precisely at the source of truth. Integration-level (HTTP + persisted)
 *  coverage for the single-item PATCH and batch routes lives in
 *  `ApiRoutesSpec` alongside the existing HEL-305 appearance tests. */
class PanelAppearanceMergeSpec extends AnyWordSpec with Matchers with OptionValues {

  private val storedChart = ChartAppearance(
    seriesColors = Vector("#111111", "#222222"),
    legend       = ChartLegend(show = false, position = "bottom"),
    tooltip      = ChartTooltip(enabled = false),
    axisLabels = ChartAxisLabels(
      x = ChartAxisLabel(show = false, label = Some("Custom X")),
      y = ChartAxisLabel(show = false, label = Some("Custom Y"))
    ),
    chartType = Some("bar")
  )

  private val stored = PanelAppearance(
    background   = "#0a0a0a",
    color        = "#ffffff",
    transparency = 0.25,
    chart        = Some(storedChart)
  )


  "PanelAppearance.applyPatchJson" should {
    "preserve the stored background when the field is genuinely absent from the JSON" in {
      // Field is absent from the JsObject entirely — not `null` — the hazard
      // this ticket exists to catch (naive Option decoding collapses both).
      val json = JsObject("background" -> JsString("#0a0"))
      val Right(merged) = PanelAppearance.applyPatchJson(json, stored): @unchecked

      merged.background shouldBe "#0a0"
      merged.color shouldBe stored.color
      merged.transparency shouldBe stored.transparency
      merged.chart shouldBe stored.chart
    }


    "accept a partial chart payload and leave unlisted chart fields at stored values" in {
      val json = JsObject("chart" -> JsObject("chartType" -> JsString("scatter")))
      val Right(merged) = PanelAppearance.applyPatchJson(json, stored): @unchecked

      merged.background shouldBe stored.background
      merged.color shouldBe stored.color
      merged.transparency shouldBe stored.transparency
      val chart = merged.chart.value
      chart.chartType shouldBe Some("scatter")
      chart.seriesColors shouldBe storedChart.seriesColors
      chart.legend shouldBe storedChart.legend
      chart.tooltip shouldBe storedChart.tooltip
      chart.axisLabels shouldBe storedChart.axisLabels
    }

    "merge a partial chart payload over ChartAppearance.Default when the panel has no stored chart" in {
      val noChart = stored.copy(chart = None)
      val json    = JsObject("chart" -> JsObject("chartType" -> JsString("pie")))
      val Right(merged) = PanelAppearance.applyPatchJson(json, noChart): @unchecked

      merged.chart.value shouldBe ChartAppearance.Default.copy(chartType = Some("pie"))
    }

    // ── Task 5.6: explicit null resets to Default, with the chartType exception ──

    "reset a top-level field to PanelAppearance.Default on explicit null" in {
      val json = JsObject("background" -> JsNull)
      val Right(merged) = PanelAppearance.applyPatchJson(json, stored): @unchecked

      merged.background shouldBe PanelAppearance.Default.background
      merged.color shouldBe stored.color
    }

    "clear the whole chart sub-object on explicit null" in {
      val json = JsObject("chart" -> JsNull)
      val Right(merged) = PanelAppearance.applyPatchJson(json, stored): @unchecked

      merged.chart shouldBe None
    }

    "clear only chartType (not reset to the line default) when chartType is explicitly null inside a chart patch" in {
      val json = JsObject("chart" -> JsObject("chartType" -> JsNull))
      val Right(merged) = PanelAppearance.applyPatchJson(json, stored): @unchecked

      val chart = merged.chart.value
      chart.chartType shouldBe None
      chart.chartType should not be ChartAppearance.Default.chartType
      // every other chart field is untouched by the null-chartType-only patch
      chart.seriesColors shouldBe storedChart.seriesColors
      chart.legend shouldBe storedChart.legend
    }

    "reset other chart fields (e.g. legend) to ChartAppearance.Default on explicit null" in {
      val json = JsObject("chart" -> JsObject("legend" -> JsNull))
      val Right(merged) = PanelAppearance.applyPatchJson(json, stored): @unchecked

      merged.chart.value.legend shouldBe ChartAppearance.Default.legend
      merged.chart.value.chartType shouldBe storedChart.chartType
    }


    "reject an invalid chartType with a curated error message" in {
      val json = JsObject("chart" -> JsObject("chartType" -> JsString("donut")))
      PanelAppearance.applyPatchJson(json, stored) match {
        case Left(err) => err should include("bar, line, pie, scatter")
        case Right(_)  => fail("expected Left for an invalid chartType")
      }
    }

    // ── Task 5.7: a full payload merges to an identical result as a full replace ──

    "produce an identical result to a full replace when every field is present (backward compat)" in {
      val fullJson = JsObject(
        "background"   -> JsString("#123456"),
        "color"        -> JsString("#abcdef"),
        "transparency" -> JsNumber(0.75),
        "chart" -> JsObject(
          "seriesColors" -> JsArray(JsString("#5470c6"), JsString("#91cc75")),
          "legend"       -> JsObject("show" -> JsBoolean(true), "position" -> JsString("top")),
          "tooltip"      -> JsObject("enabled" -> JsBoolean(true)),
          "axisLabels" -> JsObject(
            "x" -> JsObject("show" -> JsBoolean(true), "label" -> JsString("X")),
            "y" -> JsObject("show" -> JsBoolean(true), "label" -> JsString("Y"))
          ),
          "chartType" -> JsString("line")
        )
      )
      val expected = PanelAppearance(
        background   = "#123456",
        color        = "#abcdef",
        transparency = 0.75,
        chart = Some(
          ChartAppearance(
            seriesColors = Vector("#5470c6", "#91cc75"),
            legend       = ChartLegend(show = true, position = "top"),
            tooltip      = ChartTooltip(enabled = true),
            axisLabels = ChartAxisLabels(
              x = ChartAxisLabel(show = true, label = Some("X")),
              y = ChartAxisLabel(show = true, label = Some("Y"))
            ),
            chartType = Some("line")
          )
        )
      )

      val Right(merged) = PanelAppearance.applyPatchJson(fullJson, stored): @unchecked
      merged shouldBe expected
    }

    "leave the appearance unchanged when the patch object is empty" in {
      val Right(merged) = PanelAppearance.applyPatchJson(JsObject.empty, stored): @unchecked
      merged shouldBe stored
    }

    // ── Task 5.7a: a top-level `appearance: null` is a no-op, not a wipe ──────

    "treat a top-level JSON null (not an object) as a no-op, preserving the stored appearance unchanged" in {
      // `{"appearance": null}` decodes `request.appearance` to `Some(JsNull)` at
      // the wire boundary (present-but-null, distinct from an omitted key), so
      // `applyPatchJson` is still invoked — with `JsNull` as the patch body.
      // `Patch.decode`'s non-JsObject fallback (`case _ => Empty`, mirroring
      // `MetricPanelConfig.Patch.decode`) makes this a no-op merge rather than a
      // wipe to `PanelAppearance.Default`.
      val Right(merged) = PanelAppearance.applyPatchJson(JsNull, stored): @unchecked
      merged shouldBe stored
    }
  }

  "ChartAppearance.applyPatch" should {
    "keep every existing field when the patch is Patch.Empty" in {
      ChartAppearance.applyPatch(ChartAppearance.Patch.Empty, storedChart) shouldBe storedChart
    }
  }
}
