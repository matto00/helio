package com.helio.infrastructure.ai

import com.helio.domain.insights.InsightPriceTable
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1755 tasks.md 5.2: the catalog's env narrowing/weights parsing and its agreement with the price table. */
class ClaudeModelCatalogSpec extends AnyWordSpec with Matchers {

  private val AllIds = Vector("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5")

  "the default catalog" should {
    "select exactly the three owner-ruled ids in picker order with weights 1, 4 and 8" in {
      val catalog = ClaudeModelCatalog.all
      catalog.selectable.map(_.id) shouldBe AllIds
      catalog.selectable.map(_.label) shouldBe Vector("Haiku 5.5", "Sonnet 5.5", "Opus 5.5")
      catalog.selectable.map(s => catalog.weightOf(s.id)) shouldBe Vector(1, 4, 8)
    }

    "price every selectable id in InsightPriceTable.Default" in {
      ClaudeModelCatalog.all.selectable.foreach { spec =>
        withClue(spec.id) { InsightPriceTable.Default.prices.keySet should contain(spec.id) }
      }
    }

    "weigh a model it does not define as 1 and give it no spec" in {
      val catalog = ClaudeModelCatalog.all
      catalog.weightOf("claude-opus-4-8") shouldBe 1
      catalog.select("claude-opus-4-8") shouldBe None
      catalog.definition("claude-opus-4-8") shouldBe None
      ClaudeModelCatalog.isCatalogId("claude-opus-4-8") shouldBe false
    }
  }

  "CLAUDE_SELECTABLE_MODELS" should {
    "narrow the selectable set, in catalog order, without ever adding an id" in {
      val catalog = ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> " claude-opus-5-5 , claude-haiku-5-5 ,claude-fable-5-2"))
      catalog.selectable.map(_.id) shouldBe Vector("claude-haiku-5-5", "claude-opus-5-5")
      catalog.select("claude-fable-5-2") shouldBe None
    }

    "fall back to all three when unset, empty or naming no catalog id" in {
      ClaudeModelCatalog.fromEnv(Map.empty).selectable.map(_.id) shouldBe AllIds
      ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> "")).selectable.map(_.id) shouldBe AllIds
      ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> "claude-fable-5-2")).selectable.map(_.id) shouldBe AllIds
    }

    "keep the rules, label and weight of a narrowed-out model that the catalog still defines" in {
      val catalog = ClaudeModelCatalog.fromEnv(Map("CLAUDE_SELECTABLE_MODELS" -> "claude-haiku-5-5"))
      catalog.isSelectable("claude-opus-5-5") shouldBe false
      catalog.definition("claude-opus-5-5").map(_.id) shouldBe Some("claude-opus-5-5")
      catalog.weightOf("claude-opus-5-5") shouldBe 8
      catalog.labelOf("claude-opus-5-5") shouldBe Some("Opus 5.5")
    }
  }

  "HELIO_BETA_MODEL_WEIGHTS" should {
    "override the weight of a named model and leave the others" in {
      val catalog = ClaudeModelCatalog.fromEnv(Map("HELIO_BETA_MODEL_WEIGHTS" -> "claude-opus-5-5=12, claude-haiku-5-5=2"))
      catalog.weightOf("claude-haiku-5-5") shouldBe 2
      catalog.weightOf("claude-sonnet-5-5") shouldBe 4
      catalog.weightOf("claude-opus-5-5") shouldBe 12
    }

    "keep the default for a malformed entry, a weight below 1, a non-number and an unknown id" in {
      val catalog = ClaudeModelCatalog.fromEnv(
        Map("HELIO_BETA_MODEL_WEIGHTS" -> "claude-haiku-5-5=0,claude-sonnet-5-5=two,claude-opus-5-5,claude-fable-5-2=3,garbage")
      )
      catalog.weightOf("claude-haiku-5-5") shouldBe 1
      catalog.weightOf("claude-sonnet-5-5") shouldBe 4
      catalog.weightOf("claude-opus-5-5") shouldBe 8
      catalog.weightOf("claude-fable-5-2") shouldBe 1
    }
  }
}
