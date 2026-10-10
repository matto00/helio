package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1417: a compute config's `type` is an optional hint; analyze must judge the expression on its
 *  merits instead of reporting the generic "compute config error" for an absent `type`. */
class ComputeOptionalTypeAnalyzeSpec extends AnyWordSpec with Matchers {

  private val input = Vector(SchemaField("price", "float"), SchemaField("qty", "integer"))

  private def infer(config: String) = StepSchemaInference.inferOutputSchema("compute", config, input)

  "compute schema inference without a `type`" should {

    "project the inferred type and report no error for a valid expression" in {
      val (schema, err) = infer("""{"column":"total","expression":"$price * $qty"}""")
      err shouldBe None
      schema.map(_.name) shouldBe Vector("price", "qty", "total")
      schema.last.`type` shouldBe "float"
    }

    "treat an explicit null `type` as absent" in {
      val (schema, err) = infer("""{"column":"total","expression":"$price * $qty","type":null}""")
      err shouldBe None
      schema.last.`type` shouldBe "float"
    }

    "report the specific expression problem and append a string column for an unknown field" in {
      val (schema, err) = infer("""{"column":"total","expression":"$nope * 2"}""")
      err.getOrElse(fail("expected a validation error")) should (include("nope") and not include "compute config error")
      schema.last.name shouldBe "total"
      schema.last.`type` shouldBe "string"
    }

    "still report the generic category when a required key is missing" in {
      infer("""{"column":"total"}""")._2 shouldBe Some("compute config error")
    }
  }

  "compute schema inference with a `type`" should {

    "use the expression's inferred type when valid, ignoring the hint" in {
      val (schema, err) = infer("""{"column":"total","expression":"$price * $qty","type":"string"}""")
      err shouldBe None
      schema.last.`type` shouldBe "float"
    }

    "fall back to the canonicalized hint when the expression is invalid" in {
      val (schema, err) = infer("""{"column":"total","expression":"$nope * 2","type":"number"}""")
      err.getOrElse(fail("expected a validation error")) should include("nope")
      schema.last.`type` shouldBe "float"
    }
  }
}
