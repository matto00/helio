package com.helio.services.panels

import com.helio.domain.model._
import com.helio.domain.panels.{FormFieldSpec, FormPanel, FormPanelConfig, FormSubmitSpec}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** HEL-1834: the compact-counter predicate (cases mirror the client's `compactCounter` tests) and the
 *  form-minimum-rows rule + free-space test (mirrors `isSpaceBelowFree` in `panelGridConfig.ts`). */
class FormPlacementRuleSpec extends AnyWordSpec with Matchers {

  private def cfg(fields: FormFieldSpec*): FormPanelConfig =
    FormPanelConfig(DataSourceId("ds"), fields.toVector, FormSubmitSpec.Default)

  private val owner = UserId("u")
  private def form(config: FormPanelConfig): FormPanel = {
    val now = Instant.now()
    FormPanel(PanelId("p"), DashboardId("d"), "t", ResourceMeta(owner.value, now, now), PanelAppearance.Default, owner, config)
  }

  private def item(p: String, x: Int, y: Int, w: Int, h: Int) = DashboardLayoutItem(PanelId(p), x, y, w, h)

  "FormPanelConfig.isCompactCounter" should {
    "be false for zero fields and for the Empty config" in {
      FormPanelConfig.isCompactCounter(cfg()) shouldBe false
      FormPanelConfig.isCompactCounter(FormPanelConfig.Empty) shouldBe false
    }
    "be true for exactly one counter field" in {
      FormPanelConfig.isCompactCounter(cfg(FormFieldSpec("d", "counter"))) shouldBe true
    }
    "be false for one non-counter field" in {
      FormPanelConfig.isCompactCounter(cfg(FormFieldSpec("d", "number"))) shouldBe false
    }
    "be false for two fields even when one is a counter" in {
      FormPanelConfig.isCompactCounter(cfg(FormFieldSpec("d", "counter"), FormFieldSpec("n", "text"))) shouldBe false
    }
  }

  "FormPlacementRule.minRowsFor" should {
    "be 5 for a non-counter form and 1 for a compact counter" in {
      FormPlacementRule.minRowsFor(form(cfg(FormFieldSpec("a", "number"), FormFieldSpec("b", "text")))) shouldBe 5
      FormPlacementRule.minRowsFor(form(FormPanelConfig.Empty)) shouldBe 5
      FormPlacementRule.minRowsFor(form(cfg(FormFieldSpec("d", "counter")))) shouldBe 1
    }
  }

  "FormPlacementRule.isSpaceBelowFree" should {
    val target = item("t", 0, 0, 4, 4)
    "be true when nothing else is on the rows below in the target's columns" in {
      FormPlacementRule.isSpaceBelowFree(Vector(target), target, 5) shouldBe true
    }
    "be false when another item occupies the row directly below in an overlapping column" in {
      FormPlacementRule.isSpaceBelowFree(Vector(target, item("o", 3, 4, 2, 1)), target, 5) shouldBe false
    }
    "ignore an item beside the target (touching columns) or further below than the grown height" in {
      FormPlacementRule.isSpaceBelowFree(Vector(target, item("o", 4, 4, 2, 2), item("p", 0, 5, 4, 2)), target, 5) shouldBe true
    }
    "ignore the target itself by panel id" in {
      FormPlacementRule.isSpaceBelowFree(Vector(item("t", 0, 4, 4, 1)), target, 5) shouldBe true
    }
  }
}
