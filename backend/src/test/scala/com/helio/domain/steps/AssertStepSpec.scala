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

    "records one AssertionResult per rule into ctx.assertionSink, stamped with the step's id" in {
      val rows = Seq(Map[String, Any]("id" -> "1"))
      val step = AssertStep(
        id         = PipelineStepId("step-42"),
        pipelineId = PipelineId("pipe-1"),
        position   = 0,
        config     = AssertConfig(Vector(
          AssertRule("notNull", Some("id"), JsObject.empty, "error"),
          AssertRule("rowCountMin", None, JsObject("count" -> JsNumber(5)), "warn")
        )),
        createdAt  = Instant.now(),
        updatedAt  = Instant.now()
      )
      val ctx = PipelineExecutionContext(
        dataSourceRepo = null,
        loadSource     = _ => Future.successful(Seq.empty)
      )
      Await.result(step.evaluate(rows, ctx), 1.second)
      ctx.assertionSink.results should have size 2
      ctx.assertionSink.results.foreach(_.stepId shouldBe "step-42")
    }
  }

  // ── HEL-509 (419-B): AssertStep.evaluateRules — per-kind evaluation semantics ──

  "AssertStep.evaluateRules" should {

    def rule(kind: String, field: Option[String] = None, params: JsObject = JsObject.empty, severity: String = "error"): AssertRule =
      AssertRule(kind, field, params, severity)

    "notNull rule fails when any row has a null in the target field" in {
      val rows = Seq(Map[String, Any]("email" -> "a@x.com"), Map[String, Any]("email" -> null))
      val result = AssertStep.evaluateRules(rows, Vector(rule("notNull", Some("email")))).head
      result.passed shouldBe false
      result.message shouldBe defined
    }

    "notNull rule passes when no row has a null in the target field" in {
      val rows = Seq(Map[String, Any]("email" -> "a@x.com"), Map[String, Any]("email" -> "b@x.com"))
      val result = AssertStep.evaluateRules(rows, Vector(rule("notNull", Some("email")))).head
      result.passed shouldBe true
      result.message shouldBe None
    }

    "notNull rule fails when the field is entirely absent from a row (not just null)" in {
      val rows = Seq(Map[String, Any]("email" -> "a@x.com"), Map[String, Any]())
      val result = AssertStep.evaluateRules(rows, Vector(rule("notNull", Some("email")))).head
      result.passed shouldBe false
    }

    "unique rule fails on a duplicate non-null value" in {
      val rows = Seq(Map[String, Any]("id" -> "1"), Map[String, Any]("id" -> "1"))
      val result = AssertStep.evaluateRules(rows, Vector(rule("unique", Some("id")))).head
      result.passed shouldBe false
    }

    "unique rule does not fail on multiple nulls" in {
      val rows = Seq(Map[String, Any]("id" -> null), Map[String, Any]("id" -> null))
      val result = AssertStep.evaluateRules(rows, Vector(rule("unique", Some("id")))).head
      result.passed shouldBe true
    }

    "unique rule passes when all non-null values are distinct" in {
      val rows = Seq(Map[String, Any]("id" -> "1"), Map[String, Any]("id" -> "2"))
      val result = AssertStep.evaluateRules(rows, Vector(rule("unique", Some("id")))).head
      result.passed shouldBe true
    }

    "range rule fails when a value falls outside the bound" in {
      val rows = Seq(Map[String, Any]("age" -> 45), Map[String, Any]("age" -> 200))
      val params = JsObject("min" -> JsNumber(0), "max" -> JsNumber(120))
      val result = AssertStep.evaluateRules(rows, Vector(rule("range", Some("age"), params))).head
      result.passed shouldBe false
    }

    "range rule passes when every value is within the bound" in {
      val rows = Seq(Map[String, Any]("age" -> 45), Map[String, Any]("age" -> 30))
      val params = JsObject("min" -> JsNumber(0), "max" -> JsNumber(120))
      val result = AssertStep.evaluateRules(rows, Vector(rule("range", Some("age"), params))).head
      result.passed shouldBe true
    }

    "range rule with only min set fails a value below it" in {
      val rows = Seq(Map[String, Any]("age" -> -1))
      val params = JsObject("min" -> JsNumber(0))
      val result = AssertStep.evaluateRules(rows, Vector(rule("range", Some("age"), params))).head
      result.passed shouldBe false
    }

    "range rule treats a non-numeric value as a failure (can't prove it's in range)" in {
      val rows = Seq(Map[String, Any]("age" -> "not-a-number"))
      val params = JsObject("min" -> JsNumber(0), "max" -> JsNumber(120))
      val result = AssertStep.evaluateRules(rows, Vector(rule("range", Some("age"), params))).head
      result.passed shouldBe false
    }

    "range rule with neither min nor max is malformed and never throws" in {
      val rows = Seq(Map[String, Any]("age" -> 45))
      noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule("range", Some("age"))))
      val result = AssertStep.evaluateRules(rows, Vector(rule("range", Some("age")))).head
      result.passed shouldBe false
      result.message shouldBe defined
    }

    "rowCountMin rule fails when the row count is below the threshold" in {
      val rows = Seq.fill(3)(Map[String, Any]("x" -> 1))
      val params = JsObject("count" -> JsNumber(5))
      val result = AssertStep.evaluateRules(rows, Vector(rule("rowCountMin", params = params))).head
      result.passed shouldBe false
    }

    "rowCountMin rule passes when the row count meets the threshold" in {
      val rows = Seq.fill(5)(Map[String, Any]("x" -> 1))
      val params = JsObject("count" -> JsNumber(5))
      val result = AssertStep.evaluateRules(rows, Vector(rule("rowCountMin", params = params))).head
      result.passed shouldBe true
    }

    "rowCountMax rule fails when the row count exceeds the threshold" in {
      val rows = Seq.fill(10)(Map[String, Any]("x" -> 1))
      val params = JsObject("count" -> JsNumber(5))
      val result = AssertStep.evaluateRules(rows, Vector(rule("rowCountMax", params = params))).head
      result.passed shouldBe false
    }

    "rowCountMax rule passes when the row count is within the threshold" in {
      val rows = Seq.fill(5)(Map[String, Any]("x" -> 1))
      val params = JsObject("count" -> JsNumber(5))
      val result = AssertStep.evaluateRules(rows, Vector(rule("rowCountMax", params = params))).head
      result.passed shouldBe true
    }

    "rowCountMin/rowCountMax never consult 'field' even when one is set" in {
      val rows = Seq.fill(5)(Map[String, Any]("x" -> 1))
      val params = JsObject("count" -> JsNumber(5))
      val result = AssertStep.evaluateRules(rows, Vector(rule("rowCountMin", Some("irrelevant"), params))).head
      result.passed shouldBe true
      result.field shouldBe None
    }

    "rowCountMin rule missing 'count' in params is malformed and never throws" in {
      val rows = Seq.fill(3)(Map[String, Any]("x" -> 1))
      noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule("rowCountMin")))
      AssertStep.evaluateRules(rows, Vector(rule("rowCountMin"))).head.passed shouldBe false
    }

    "regex rule fails when a value doesn't match the pattern" in {
      val rows = Seq(Map[String, Any]("code" -> "ABC"), Map[String, Any]("code" -> "ab"))
      val params = JsObject("pattern" -> JsString("^[A-Z]{3}$"))
      val result = AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"), params))).head
      result.passed shouldBe false
    }

    "regex rule passes when every value matches the pattern" in {
      val rows = Seq(Map[String, Any]("code" -> "ABC"), Map[String, Any]("code" -> "XYZ"))
      val params = JsObject("pattern" -> JsString("^[A-Z]{3}$"))
      val result = AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"), params))).head
      result.passed shouldBe true
    }

    "regex rule matches partially (find, not matches) mirroring StringOpsStep.extractRegexFn" in {
      val rows = Seq(Map[String, Any]("code" -> "prefix-ABC-suffix"))
      val params = JsObject("pattern" -> JsString("ABC"))
      val result = AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"), params))).head
      result.passed shouldBe true
    }

    "regex rule fails gracefully on a null or absent field, without throwing" in {
      val rows = Seq(Map[String, Any]("code" -> null), Map[String, Any]())
      val params = JsObject("pattern" -> JsString("^[A-Z]{3}$"))
      noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"), params)))
      val result = AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"), params))).head
      result.passed shouldBe false
    }

    "regex rule with an invalid pattern is malformed and never throws" in {
      val rows = Seq(Map[String, Any]("code" -> "abc"))
      val params = JsObject("pattern" -> JsString("("))
      noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"), params)))
      AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"), params))).head.passed shouldBe false
    }

    "regex rule missing params.pattern is malformed and never throws" in {
      val rows = Seq(Map[String, Any]("code" -> "abc"))
      noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code"))))
      AssertStep.evaluateRules(rows, Vector(rule("regex", Some("code")))).head.passed shouldBe false
    }

    "notNull/unique/range/regex rules missing 'field' are malformed and never throw" in {
      val rows = Seq(Map[String, Any]("x" -> 1))
      for (kind <- Vector("notNull", "unique", "range", "regex")) {
        noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule(kind)))
        val result = AssertStep.evaluateRules(rows, Vector(rule(kind))).head
        result.passed shouldBe false
        result.message shouldBe defined
      }
    }

    "an unknown rule kind is malformed and never throws" in {
      val rows = Seq(Map[String, Any]("x" -> 1))
      noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule("bogusKind")))
      AssertStep.evaluateRules(rows, Vector(rule("bogusKind"))).head.passed shouldBe false
    }

    "an invalid severity is malformed and never throws" in {
      val rows = Seq(Map[String, Any]("id" -> "1"))
      noException should be thrownBy AssertStep.evaluateRules(rows, Vector(rule("notNull", Some("id"), severity = "critical")))
      AssertStep.evaluateRules(rows, Vector(rule("notNull", Some("id"), severity = "critical"))).head.passed shouldBe false
    }

    "multiple rules each produce their own AssertionResult, aggregated across the row set (not per row)" in {
      val rows = Seq(Map[String, Any]("id" -> "1"), Map[String, Any]("id" -> "2"), Map[String, Any]("id" -> "3"))
      val rules = Vector(
        rule("notNull", Some("id")),
        rule("rowCountMin", params = JsObject("count" -> JsNumber(1)))
      )
      val results = AssertStep.evaluateRules(rows, rules)
      results should have size 2
      results.foreach(_.passed shouldBe true)
    }
  }
}
