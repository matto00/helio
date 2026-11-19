package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1740 D4 path 2: a single-call pipeline create has no Output an insight could read yet. */
class InsightPreflightSpec extends AnyWordSpec with Matchers {
  private def cfg(s: String): JsObject = s.parseJson.asJsObject

  "PipelineCreatePreflight.validateOutputConfig for an insight" should {
    "reject any reads.outputs id for a brand-new pipeline, naming reads.outputs" in {
      val r = PipelineCreatePreflight.validateOutputConfig(OutputKind.Insight, cfg("""{"reads":{"outputs":["x"]}}"""))
      r.left.map(_.message).left.getOrElse("") should include("reads.outputs")
    }
    "reject an unknown key and an out-of-range value, naming the key" in {
      PipelineCreatePreflight.validateOutputConfig(OutputKind.Insight, cfg("""{"bogus":"x"}""")).left.map(_.message).left.getOrElse("") should include("bogus")
      PipelineCreatePreflight.validateOutputConfig(OutputKind.Insight, cfg("""{"refresh":"hourly"}""")).left.map(_.message).left.getOrElse("") should include("refresh")
    }
    // HEL-1743 R1: single-call POST /api/pipelines with outputs.
    "reject a model outside the catalog, naming model, and accept a selectable one" in {
      for (bad <- Seq("claude-opus-4-8", "gpt-5", "")) {
        val r = PipelineCreatePreflight.validateOutputConfig(OutputKind.Insight, JsObject("model" -> JsString(bad)))
        withClue(bad)(r.left.map(_.message).left.getOrElse("") should include("model"))
      }
      PipelineCreatePreflight.validateOutputConfig(OutputKind.Insight, JsObject("model" -> JsString("claude-haiku-5-5"))) shouldBe Right(())
    }
    "accept an insight with no reads, or an empty reads.outputs" in {
      PipelineCreatePreflight.validateOutputConfig(OutputKind.Insight, JsObject.empty) shouldBe Right(())
      PipelineCreatePreflight.validateOutputConfig(OutputKind.Insight, cfg("""{"reads":{"outputs":[]}}""")) shouldBe Right(())
    }
  }
}
