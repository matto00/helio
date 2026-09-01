package com.helio.domain.panels

import com.helio.domain.engine.SchemaField
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-906 (task 3.6, absorbed bug HEL-892): unit coverage for
 *  `OutputBindingSpec.validateFieldMapping` — slot-name validation is
 *  distinct from `evaluate`'s column-type eligibility, and is untested
 *  elsewhere since no live route calls it yet (see execution-progress.md).
 *  HEL-907 task 1.4 adds `validateFieldMappingColumnsExist` coverage --
 *  the per-node grounding check, distinct again: this one validates the
 *  mapping's VALUES (column names) exist in a given projected schema,
 *  never its keys (slot names). Integration-level "grounded against the
 *  RIGHT node's schema, not the trunk's" coverage lives in
 *  `PipelineCreateTransactionalSpec` (task 5.4). */
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

  "OutputBindingSpec.validateFieldMappingColumnsExist" should {

    val schema = Vector(SchemaField("amount", "float"), SchemaField("label", "string"))

    "accept a mapping whose every value names a column present in schema" in {
      OutputBindingSpec.validateFieldMappingColumnsExist(
        Map("value" -> "amount", "label" -> "label"), schema
      ) shouldBe Right(())
    }

    "reject a mapping naming a column absent from schema, naming the missing column" in {
      val result = OutputBindingSpec.validateFieldMappingColumnsExist(Map("value" -> "revenue"), schema)
      result shouldBe a[Left[_, _]]
      result.left.getOrElse("") should include("revenue")
    }

    "name every missing column, not just the first, when multiple values are absent" in {
      val result = OutputBindingSpec.validateFieldMappingColumnsExist(
        Map("value" -> "revenue", "label" -> "category"), schema
      )
      val message = result.left.getOrElse("")
      message should include("revenue")
      message should include("category")
    }

    "accept an empty mapping unconditionally, regardless of schema" in {
      OutputBindingSpec.validateFieldMappingColumnsExist(Map.empty, Vector.empty) shouldBe Right(())
    }

    "reject the SAME column name that IS a valid slot elsewhere but is absent from THIS schema (the tail-vs-trunk grounding scenario)" in {
      val narrowedSchema = Vector(SchemaField("amount", "float")) // "label" dropped by an upstream select
      val result = OutputBindingSpec.validateFieldMappingColumnsExist(Map("label" -> "label"), narrowedSchema)
      result shouldBe a[Left[_, _]]
      result.left.getOrElse("") should include("label")
    }
  }
}
