package com.helio.domain.panels

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-906 (task 3.6, absorbed bug HEL-892): unit coverage for
 *  `OutputBindingSpec.validateFieldMapping` — slot-name validation is
 *  distinct from `evaluate`'s column-type eligibility, and is untested
 *  elsewhere since no live route calls it yet (see execution-progress.md). */
class OutputBindingSpecSpec extends AnyWordSpec with Matchers {

  "OutputBindingSpec.validateFieldMapping" should {

    "accept a fieldMapping using only known slots for the kind" in {
      val result = OutputBindingSpec.validateFieldMapping(
        OutputBindingSpec.Metric,
        Map("value" -> "amount", "label" -> "category")
      )
      result shouldBe Right(())
    }

    "reject an unknown slot name, naming it and the full valid-slot list (HEL-892)" in {
      val result = OutputBindingSpec.validateFieldMapping(
        OutputBindingSpec.Metric,
        Map("value" -> "amount", "bogusSlot" -> "whatever")
      )
      result shouldBe a[Left[_, _]]
      val message = result.left.getOrElse("")
      message should include("bogusSlot")
      message should include("value")
      message should include("label")
      message should include("unit")
    }

    "reject a slot valid for a DIFFERENT kind (e.g. chart's xAxis on a metric mapping)" in {
      val result = OutputBindingSpec.validateFieldMapping(OutputBindingSpec.Metric, Map("xAxis" -> "month"))
      result shouldBe a[Left[_, _]]
      result.left.getOrElse("") should include("xAxis")
    }

    "report every unknown key, not just the first, when multiple are present" in {
      val result = OutputBindingSpec.validateFieldMapping(
        OutputBindingSpec.Table,
        Map("bogus1" -> "a", "bogus2" -> "b")
      )
      val message = result.left.getOrElse("")
      message should include("bogus1")
      message should include("bogus2")
    }

    "accept an empty fieldMapping against a no-slot kind (table/markdown)" in {
      OutputBindingSpec.validateFieldMapping(OutputBindingSpec.Table, Map.empty) shouldBe Right(())
      OutputBindingSpec.validateFieldMapping(OutputBindingSpec.Markdown, Map.empty) shouldBe Right(())
    }
  }
}
