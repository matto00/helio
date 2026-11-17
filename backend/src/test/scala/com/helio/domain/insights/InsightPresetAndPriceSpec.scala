package com.helio.domain.insights

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1741 tasks 1.3/1.4: preset inference and the cost table. */
class InsightPresetAndPriceSpec extends AnyWordSpec with Matchers {

  private def cfg(json: String): JsObject = json.parseJson.asJsObject
  private def sig(outputs: (OutputKind, JsObject)*): InsightNodeSignals = InsightNodeSignals(outputs.toVector, Map.empty, Vector.empty)

  "InsightPreset" should {
    "round-trip its string form" in {
      InsightPreset.all.foreach(p => InsightPreset.fromString(p.asString) shouldBe Some(p))
      InsightPreset.fromString("nope") shouldBe None
    }
  }

  "InsightPresetInference" should {
    "infer delta for a metric with a valid compare" in {
      InsightPresetInference.infer(InsightPreset.Auto, sig(OutputKind.Metric -> cfg("""{"compare":"7d"}"""))) shouldBe InsightPreset.Delta
    }
    "not infer delta for a metric with an invalid or absent compare" in {
      InsightPresetInference.infer(InsightPreset.Auto, sig(OutputKind.Metric -> cfg("""{"compare":"bogus"}"""))) shouldBe InsightPreset.Summary
      InsightPresetInference.infer(InsightPreset.Auto, sig(OutputKind.Metric -> cfg("{}"))) shouldBe InsightPreset.Summary
    }
    "infer trend for a line chart, an untyped chart and a chart on a date column" in {
      InsightPresetInference.infer(InsightPreset.Auto, sig(OutputKind.Chart -> cfg("""{"chartType":"line"}"""))) shouldBe InsightPreset.Trend
      InsightPresetInference.infer(InsightPreset.Auto, sig(OutputKind.Chart -> cfg("{}"))) shouldBe InsightPreset.Trend
      val bar = sig(OutputKind.Chart -> cfg("""{"chartType":"bar","fieldMapping":{"xAxis":"day"}}"""))
      InsightPresetInference.infer(InsightPreset.Auto, bar) shouldBe InsightPreset.Summary
      InsightPresetInference.infer(InsightPreset.Auto, bar.copy(columnTypes = Map("day" -> "date"))) shouldBe InsightPreset.Trend
    }
    "infer leaders for a table ending in sort then limit" in {
      val table = sig(OutputKind.Table -> cfg("{}")).copy(stepOps = Vector("filter", "sort", "limit"))
      InsightPresetInference.infer(InsightPreset.Auto, table) shouldBe InsightPreset.Leaders
      InsightPresetInference.infer(InsightPreset.Auto, table.copy(stepOps = Vector("limit", "sort"))) shouldBe InsightPreset.Summary
    }
    "prefer delta over trend over leaders and pass an explicit preset through" in {
      val all = sig(OutputKind.Metric -> cfg("""{"compare":"1d"}"""), OutputKind.Chart -> cfg("{}"), OutputKind.Table -> cfg("{}")).copy(stepOps = Vector("sort", "limit"))
      InsightPresetInference.infer(InsightPreset.Auto, all) shouldBe InsightPreset.Delta
      InsightPresetInference.infer(InsightPreset.Leaders, all) shouldBe InsightPreset.Leaders
    }
  }

  "InsightPriceTable" should {
    "price 1M input plus 1M output tokens as the model's input plus output price" in {
      InsightPriceTable.Default.costMicros("claude-opus-4-8", InsightUsage(1000000, 1000000)) shouldBe Some(30000000L)
      InsightPriceTable.Default.costMicros("claude-haiku-5-5", InsightUsage(1000000, 1000000)) shouldBe Some(600000L)
    }
    "include cache write and read tokens and round half up" in {
      InsightPriceTable.Default.costMicros("claude-opus-4-8", InsightUsage(0, 0, 1000000, 1000000)) shouldBe Some(6750000L)
      InsightPriceTable.Default.costMicros("claude-haiku-5-5", InsightUsage(5, 0)) shouldBe Some(1L)
    }
    "return none for an unknown model, and state its source" in {
      InsightPriceTable.Default.costMicros("claude-unknown", InsightUsage(10, 10)) shouldBe None
      InsightPriceTable.Default.sourceUrl should include("platform.claude.com")
      InsightPriceTable.Default.readOn shouldBe "2026-11-17"
    }
  }
}
