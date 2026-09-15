package com.helio.domain.steps

import org.scalatest.OptionValues
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1106 (design.md D1, tasks.md 3.4): `AnalyzeWithAiConfig`'s tolerant READ-path decode and
 *  the shared write-path/analyze-time `validate`. */
class AnalyzeWithAiConfigSpec extends AnyWordSpec with Matchers with OptionValues {

  private def validConfig: AnalyzeWithAiConfig =
    AnalyzeWithAiConfig("content", "Classify sentiment", Vector(AnalyzeWithAiOutputField("sentiment", "string")))

  "AnalyzeWithAiConfig.decode" should {
    "default every field when the raw config is an empty object (legacy/partial row tolerance)" in {
      val cfg = AnalyzeWithAiConfig.decode("{}")
      cfg shouldBe AnalyzeWithAiConfig("", "", Vector.empty)
    }

    "preserve outputSchema array order exactly as written" in {
      val raw = """{"inputField":"content","instruction":"go","outputSchema":[{"name":"z","type":"string"},{"name":"a","type":"integer"}]}"""
      val cfg = AnalyzeWithAiConfig.decode(raw)
      cfg.outputSchema.map(_.name) shouldBe Vector("z", "a")
    }

    "raise StepConfigTypeMismatch when a present key has the wrong JSON type" in {
      a[StepConfigTypeMismatch] should be thrownBy AnalyzeWithAiConfig.decode("""{"inputField":42}""")
    }
  }

  "AnalyzeWithAiConfig.format (round trip)" should {
    "write outputSchema as a JsArray (order-preserving) rather than a JsObject" in {
      import spray.json._
      val cfg  = AnalyzeWithAiConfig("content", "go", Vector(AnalyzeWithAiOutputField("z", "string"), AnalyzeWithAiOutputField("a", "integer")))
      val json = cfg.toJson.asJsObject
      json.fields("outputSchema") shouldBe a[JsArray]
      json.fields("outputSchema").asInstanceOf[JsArray].elements.map(_.asJsObject.fields("name")) shouldBe
        Vector(JsString("z"), JsString("a"))
    }

    "round trip through write then read unchanged" in {
      import spray.json._
      val cfg = validConfig
      cfg.toJson.convertTo[AnalyzeWithAiConfig] shouldBe cfg
    }
  }

  "AnalyzeWithAiConfig.validate" should {
    "accept a fully valid config" in {
      AnalyzeWithAiConfig.validate(validConfig) shouldBe None
    }

    "reject an empty inputField" in {
      AnalyzeWithAiConfig.validate(validConfig.copy(inputField = "")).value should include("inputField")
    }

    "reject an empty instruction" in {
      AnalyzeWithAiConfig.validate(validConfig.copy(instruction = "")).value should include("instruction")
    }

    "reject an empty outputSchema" in {
      AnalyzeWithAiConfig.validate(validConfig.copy(outputSchema = Vector.empty)).value should include("outputSchema")
    }

    "reject more than 50 outputSchema entries" in {
      val many = (1 to 51).map(i => AnalyzeWithAiOutputField(s"f$i", "string")).toVector
      AnalyzeWithAiConfig.validate(validConfig.copy(outputSchema = many)).value should include("at most 50")
    }

    "reject a duplicate output name" in {
      val dup = Vector(AnalyzeWithAiOutputField("x", "string"), AnalyzeWithAiOutputField("x", "integer"))
      AnalyzeWithAiConfig.validate(validConfig.copy(outputSchema = dup)).value should include("unique")
    }

    "reject an output name equal to inputField" in {
      val collide = Vector(AnalyzeWithAiOutputField("content", "string"))
      AnalyzeWithAiConfig.validate(validConfig.copy(outputSchema = collide)).value should include("inputField")
    }

    "reject an output type outside the allowed subset (e.g. timestamp)" in {
      val bad = Vector(AnalyzeWithAiOutputField("t", "timestamp"))
      AnalyzeWithAiConfig.validate(validConfig.copy(outputSchema = bad)).value should include("must be one of")
    }
  }
}
