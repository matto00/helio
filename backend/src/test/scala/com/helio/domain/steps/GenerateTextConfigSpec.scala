package com.helio.domain.steps

import org.scalatest.OptionValues
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1107 (design.md D2, tasks.md 1.1): `GenerateTextConfig`'s tolerant READ-path decode and
 *  the shared write-path/analyze-time `validate`. */
class GenerateTextConfigSpec extends AnyWordSpec with Matchers with OptionValues {

  private def validConfig: GenerateTextConfig =
    GenerateTextConfig(inputField = "content", instruction = "Summarize this", outputField = "summary")

  "GenerateTextConfig.decode" should {
    "default every field to empty string when the raw config is an empty object (legacy/partial row tolerance)" in {
      GenerateTextConfig.decode("{}") shouldBe GenerateTextConfig("", "", "")
    }

    "decode a fully populated config" in {
      val raw = """{"inputField":"content","instruction":"Summarize","outputField":"summary"}"""
      GenerateTextConfig.decode(raw) shouldBe GenerateTextConfig("content", "Summarize", "summary")
    }

    "raise StepConfigTypeMismatch when a present key has the wrong JSON type" in {
      a[StepConfigTypeMismatch] should be thrownBy GenerateTextConfig.decode("""{"inputField":42}""")
    }
  }

  "GenerateTextConfig.format (round trip)" should {
    "round trip through write then read unchanged" in {
      import spray.json._
      val cfg = validConfig
      cfg.toJson.convertTo[GenerateTextConfig] shouldBe cfg
    }
  }

  "GenerateTextConfig.validate" should {
    "accept a fully valid config" in {
      GenerateTextConfig.validate(validConfig) shouldBe None
    }

    "reject an empty inputField" in {
      GenerateTextConfig.validate(validConfig.copy(inputField = "")).value should include("inputField")
    }

    "reject an empty instruction" in {
      GenerateTextConfig.validate(validConfig.copy(instruction = "")).value should include("instruction")
    }

    "reject an empty outputField" in {
      GenerateTextConfig.validate(validConfig.copy(outputField = "")).value should include("outputField")
    }

    "reject a config with every key absent (all-keys-absent case)" in {
      GenerateTextConfig.validate(GenerateTextConfig.decode("{}")).value should include("inputField")
    }
  }
}
