package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1743 R1/D7: every Output config writer (create, update, draft save, patch-set apply) judges an insight's `model`
 *  through `OutputConfigValidation.validate`, against the shared `ClaudeModelCatalog`'s selectable set. */
class InsightModelConfigWriteSpec extends AnyWordSpec with Matchers {
  private def cfg(s: String): JsObject = s.parseJson.asJsObject
  private def validate(written: String, stored: String = "{}") =
    OutputConfigValidation.validate(OutputKind.Insight, cfg(written), cfg(stored))

  "OutputConfigValidation for an insight's model" should {
    "reject an id outside the catalog and a non-string, naming model" in {
      validate("""{"model":"claude-opus-4-8"}""").left.getOrElse("") should include("model")
      validate("""{"model":42}""").left.getOrElse("") should include("model")
    }
    "accept every selectable catalog id and a clear (null)" in {
      for (id <- Seq("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"))
        validate(s"""{"model":"$id"}""") shouldBe Right(())
      validate("""{"model":null}""", """{"model":"claude-haiku-5-5"}""") shouldBe Right(())
    }
    "judge a stored model again on any later insight-key write (same as chat), so it must be changed or cleared" in {
      validate("""{"prompt":"p"}""", """{"model":"claude-opus-4-8"}""").left.getOrElse("") should include("model")
      validate("""{"model":null,"prompt":"p"}""", """{"model":"claude-opus-4-8"}""") shouldBe Right(())
    }
  }
}
