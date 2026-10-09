package com.helio.api.protocols.panels

import com.helio.api.JsonProtocols
import com.helio.domain.model.{ChartAppearance, ChartAxisLabel, PanelAppearance}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Pins the exact JSON wire output of the appearance types so a structural move of
 *  `PanelAppearance`/`ChartAppearance` cannot silently change a default, a field order or an
 *  omitted-vs-null field. Goldens were captured from the pre-move code via the production formats. */
class PanelAppearanceWireGoldenSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private def assertGolden(appearance: PanelAppearance, golden: String): Unit = {
    appearance.toJson.compactPrint shouldBe golden
    golden.parseJson.convertTo[PanelAppearance] shouldBe appearance
  }

  "PanelAppearance wire format" should {

    "serialize PanelAppearance.Default without a chart key" in {
      assertGolden(PanelAppearance.Default, """{"background":"transparent","color":"inherit","transparency":0.0}""")
    }

    "serialize a panel carrying ChartAppearance.Default" in {
      assertGolden(PanelAppearance.Default.copy(chart = Some(ChartAppearance.Default)), """{"background":"transparent","chart":{"axisLabels":{"x":{"label":"","show":true},"y":{"label":"","show":true}},"chartType":"line","legend":{"position":"top","show":true},"seriesColors":["#5470c6","#91cc75","#fac858","#ee6666","#73c0de","#3ba272","#fc8452","#9a60b4"],"tooltip":{"enabled":true}},"color":"inherit","transparency":0.0}""")
    }

    "omit chartType and a None axis label rather than writing null" in {
      val chart = ChartAppearance.Default.copy(
        chartType  = None,
        axisLabels = ChartAppearance.Default.axisLabels.copy(x = ChartAxisLabel(show = false, label = None))
      )
      assertGolden(PanelAppearance.Default.copy(chart = Some(chart)), """{"background":"transparent","chart":{"axisLabels":{"x":{"show":false},"y":{"label":"","show":true}},"legend":{"position":"top","show":true},"seriesColors":["#5470c6","#91cc75","#fac858","#ee6666","#73c0de","#3ba272","#fc8452","#9a60b4"],"tooltip":{"enabled":true}},"color":"inherit","transparency":0.0}""")
    }

    "serialize the result of a partial chart patch on a chartless panel with no invented chartType" in {
      val patch  = JsObject("chart" -> JsObject("legend" -> JsObject("show" -> JsBoolean(false), "position" -> JsString("bottom"))))
      val Right(merged) = PanelAppearance.applyPatchJson(patch, PanelAppearance.Default): @unchecked
      assertGolden(merged, """{"background":"transparent","chart":{"axisLabels":{"x":{"label":"","show":true},"y":{"label":"","show":true}},"legend":{"position":"bottom","show":false},"seriesColors":["#5470c6","#91cc75","#fac858","#ee6666","#73c0de","#3ba272","#fc8452","#9a60b4"],"tooltip":{"enabled":true}},"color":"inherit","transparency":0.0}""")
    }

    "serialize PanelAppearanceResponse.fromDomain identically to the domain format" in {
      val appearance = PanelAppearance.Default.copy(chart = Some(ChartAppearance.Default))
      PanelAppearanceResponse.fromDomain(appearance).toJson.compactPrint shouldBe """{"background":"transparent","chart":{"axisLabels":{"x":{"label":"","show":true},"y":{"label":"","show":true}},"chartType":"line","legend":{"position":"top","show":true},"seriesColors":["#5470c6","#91cc75","#fac858","#ee6666","#73c0de","#3ba272","#fc8452","#9a60b4"],"tooltip":{"enabled":true}},"color":"inherit","transparency":0.0}"""
    }
  }
}
