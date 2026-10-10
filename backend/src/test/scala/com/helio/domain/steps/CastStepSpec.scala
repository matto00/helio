package com.helio.domain.steps

import com.helio.domain.engine.PipelineAnalyzeService
import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.PipelineStep
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1436: `CastStep` produces the run-time type analyze projects, for every supported target.
 *  Each case is labelled RED (fails on the pre-fix tree) or GUARD (already true; must be preserved). */
class CastStepSpec extends AnyWordSpec with Matchers {

  private def cast(target: String, in: Any): Any =
    CastStep.apply(Seq(Map("v" -> in)), CastConfig(Map("v" -> target))).head("v")

  "CastStep float / number (RED)" should {
    "RED: cast \"1.5\" to float yields Double 1.5" in { cast("float", "1.5") shouldBe 1.5 }
    "RED: cast \"1.5\" to number yields Double 1.5" in { cast("number", "1.5") shouldBe 1.5 }
    "RED: cast of unparseable text to float yields null" in { (cast("float", "abc") == null) shouldBe true }
    "GUARD: double still yields Double" in { cast("double", "1.5") shouldBe 1.5 }
  }

  "CastStep timestamp / date" should {
    val keep = Seq("2026-03-14T09:30:00Z", "2026-03-14", "03/14/2026", "2026-07-01 12:00:00", "1751371200", " 2026-03-14 ")
    for (target <- Seq("timestamp", "date"); s <- keep)
      s"GUARD: $target keeps '$s' unchanged (original string, untrimmed)" in { cast(target, s) shouldBe s }

    "GUARD: an integer-looking string is kept under timestamp (epoch, matching datebucket)" in { cast("timestamp", "42") shouldBe "42" }
    "GUARD: a Long epoch input yields its String form" in {
      cast("timestamp", 1751371200L) shouldBe "1751371200"
      cast("date", 1751371200L) shouldBe "1751371200"
    }
    "RED: a Double epoch (a JSON epoch number) yields null, as datebucket already does" in {
      (cast("timestamp", 1.7513712E9) == null) shouldBe true
      (cast("date", 1.7513712E9) == null) shouldBe true
    }
    for (target <- Seq("timestamp", "date"); junk <- Seq("tomorrow", "abc"))
      s"RED: $target of '$junk' yields null" in { (cast(target, junk) == null) shouldBe true }
    "GUARD: null stays null" in { (cast("timestamp", null) == null) shouldBe true }
  }

  "CastStep stored legacy targets (explicit passthrough)" should {
    for (t <- Seq("string-body", "binary-ref", "foo")) {
      s"RED: '$t' passes the ORIGINAL value through (a Double stays a Double)" in { cast(t, 2.5) shouldBe 2.5 }
      s"GUARD: '$t' passes a String through" in { cast(t, "hello") shouldBe "hello" }
    }
  }

  "CastStep existing targets" should {
    "GUARD: string/integer/long/double/boolean unchanged" in {
      cast("string", 5) shouldBe "5"
      cast("integer", "42") shouldBe 42
      cast("integer", "1.5") shouldBe 1
      cast("long", "42") shouldBe 42L
      cast("double", "2") shouldBe 2.0
      cast("boolean", "true") shouldBe true
      (cast("integer", "x") == null) shouldBe true
    }
  }

  private def castRaw(target: String) = s"""{"casts":{"doc":"$target"}}"""

  "write validation (rawConfigProblem)" should {
    for (t <- Seq("binary-ref", "string-body", "foo"))
      s"RED: rejects target '$t', naming it and the supported list" in {
        val msg = PipelineStep.rawConfigProblem("cast", castRaw(t)).getOrElse(fail(s"$t accepted"))
        msg should include(t)
        msg should include("doc")
        msg should include("float")
        msg should include("timestamp")
      }
    for (t <- Seq("string", "integer", "long", "float", "double", "number", "boolean", "date", "timestamp"))
      s"GUARD: accepts supported target '$t'" in { PipelineStep.rawConfigProblem("cast", castRaw(t)) shouldBe None }
    "GUARD: still rejects a mistyped casts map" in {
      PipelineStep.rawConfigProblem("cast", """{"casts":["a"]}""") should not be empty
    }
  }

  "write-only gating of an unsupported target (C5)" should {
    "GUARD: validateRawConfig and analyze stepConfigProblem do not report a legacy target" in {
      for (t <- Seq("binary-ref", "string-body", "foo")) {
        CastStep.companion.validateRawConfig(castRaw(t)) shouldBe None
        PipelineAnalyzeService.stepConfigProblem("cast", castRaw(t)) shouldBe None
      }
    }
  }

  "analyze projection of cast targets" should {
    def project(target: String, inType: String = "string"): (SchemaField, Option[String]) = {
      val steps = Vector(NodeStepInput("c", None, 0, "cast", castRaw(target), Some("L")))
      val a = PipelineAnalyzeService.analyzeNodes(steps, Map("L" -> Vector(SchemaField("doc", inType))))("c")
      (a.outputSchema.find(_.name == "doc").get, a.validationError)
    }
    for (t <- Seq("string-body", "binary-ref", "foo"))
      s"RED: legacy '$t' projects the input type unchanged with no validationError" in {
        project(t, "integer") shouldBe ((SchemaField("doc", "integer"), None))
      }
    "GUARD: float and number project float" in {
      project("float")._1.`type` shouldBe "float"
      project("number")._1.`type` shouldBe "float"
    }
    "GUARD: date and timestamp project timestamp" in {
      project("date")._1.`type` shouldBe "timestamp"
      project("timestamp")._1.`type` shouldBe "timestamp"
    }
  }
}
