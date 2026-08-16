package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineStepId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

/** Standalone unit-test spec for `AssertConfig.decode`'s tolerance (HEL-454 /
 *  419-A, design.md Decision 2 — never throws, per-field-lenient) and
 *  `AssertStep.evaluate`'s identity pass-through. Codec round-trip coverage
 *  lives in `PipelineStepConfigCodecSpec`; wire-format coverage lives in
 *  `PipelineStepProtocolSpec`. */
class AssertStepSpec extends AnyWordSpec with Matchers {

  "AssertConfig.decode" should {
    "missing rules key decodes to an empty rule vector" in {
      AssertConfig.decode("{}") shouldBe AssertConfig(Vector.empty)
    }

    "a well-formed rule round-trips through decode" in {
      val raw = """{"rules":[{"kind":"notNull","field":"id","params":{},"severity":"error"}]}"""
      AssertConfig.decode(raw) shouldBe AssertConfig(
        Vector(AssertRule("notNull", Some("id"), JsObject.empty, "error"))
      )
    }

    "a malformed rule entry (missing field/params/severity) does not throw and applies typed defaults" in {
      val raw = """{"rules":[{"kind":"notNull"}]}"""
      noException should be thrownBy AssertConfig.decode(raw)
      AssertConfig.decode(raw) shouldBe AssertConfig(
        Vector(AssertRule("notNull", None, JsObject.empty, "warn"))
      )
    }

    "a rule entry missing kind defaults to an empty-string kind rather than being dropped" in {
      val raw = """{"rules":[{"field":"id","params":{},"severity":"error"}]}"""
      val decoded = AssertConfig.decode(raw)
      decoded.rules should have size 1
      decoded.rules.head.kind shouldBe ""
    }

    "a non-object rule array element decodes to an all-defaults rule rather than throwing" in {
      val raw = """{"rules":["not-an-object", 42, null]}"""
      noException should be thrownBy AssertConfig.decode(raw)
      val decoded = AssertConfig.decode(raw)
      decoded.rules should have size 3
      decoded.rules.foreach(_ shouldBe AssertRule("", None, JsObject.empty, "warn"))
    }

    "a non-object top-level config decodes to empty rules rather than throwing" in {
      noException should be thrownBy AssertConfig.decode("42")
      AssertConfig.decode("42") shouldBe AssertConfig(Vector.empty)
    }

    "params preserves an arbitrary JsObject payload verbatim" in {
      val raw = """{"rules":[{"kind":"range","field":"amount","params":{"min":0,"max":100},"severity":"error"}]}"""
      val decoded = AssertConfig.decode(raw)
      decoded.rules.head.params shouldBe JsObject("min" -> JsNumber(0), "max" -> JsNumber(100))
    }

    "a non-object params value falls back to an empty object" in {
      val raw = """{"rules":[{"kind":"notNull","field":"id","params":"not-an-object","severity":"error"}]}"""
      AssertConfig.decode(raw).rules.head.params shouldBe JsObject.empty
    }
  }

  "AssertStep.evaluate" should {
    "passes rows through unchanged" in {
      val rows = Seq(Map[String, Any]("id" -> "1", "amount" -> 5), Map[String, Any]("id" -> "2", "amount" -> null))
      val step = AssertStep(
        id         = PipelineStepId("step-1"),
        pipelineId = PipelineId("pipe-1"),
        position   = 0,
        config     = AssertConfig(Vector(AssertRule("notNull", Some("id"), JsObject.empty, "error"))),
        createdAt  = Instant.now(),
        updatedAt  = Instant.now()
      )
      val ctx = PipelineExecutionContext(
        dataSourceRepo = null,
        loadSource     = _ => Future.successful(Seq.empty)
      )
      val result = Await.result(step.evaluate(rows, ctx), 1.second)
      result shouldBe rows
    }
  }
}
