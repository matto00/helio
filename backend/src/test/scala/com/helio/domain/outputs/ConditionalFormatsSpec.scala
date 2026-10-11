package com.helio.domain.outputs

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.{Files, Paths}

/** HEL-1307 task 4.1: the pure `config.conditionalFormats` shape validator. Every valid shape is accepted and
 *  every malformation in the spec is rejected with the rule index and a reason. The shared fixture is the
 *  same one the frontend editor/reader tests consume (C2). */
class ConditionalFormatsSpec extends AnyWordSpec with Matchers {

  private def kindOf(name: String): OutputKind = OutputKind.fromString(name).toOption.get
  private def cfg(rules: JsValue): JsObject = JsObject("conditionalFormats" -> rules)
  private def rule(fs: (String, JsValue)*): JsObject = JsObject(fs: _*)
  private def s(v: String): JsString = JsString(v)
  private def n(v: BigDecimal): JsNumber = JsNumber(v)
  private val base = Seq[(String, JsValue)]("op" -> s("gt"), "value" -> n(1), "tone" -> s("error"))
  private def withField(k: String, v: JsValue, kind: String = "metric"): Either[String, Unit] =
    ConditionalFormats.validateConfig(kindOf(kind), cfg(JsArray(rule((base.toMap + (k -> v)).toSeq: _*))))
  private def without(k: String): Either[String, Unit] =
    ConditionalFormats.validateConfig(kindOf("metric"), cfg(JsArray(rule(base.toMap.removed(k).toSeq: _*))))
  private def left(r: Either[String, Unit]): String = r.left.getOrElse(fail("expected Left"))

  private val fixture = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/conditional-formats-config.json"))).asJsObject

  "the shared fixture" should {
    "accept every valid case" in {
      fixture.fields("valid").asInstanceOf[JsArray].elements.foreach { c =>
        val o = c.asJsObject
        withClue(o.fields("name").convertTo[String]) {
          ConditionalFormats.validateConfig(kindOf(o.fields("kind").convertTo[String]), o.fields("config").asJsObject) shouldBe Right(())
        }
      }
    }
    "reject every invalid case naming the index and reason" in {
      fixture.fields("invalid").asInstanceOf[JsArray].elements.foreach { c =>
        val o = c.asJsObject
        withClue(o.fields("name").convertTo[String]) {
          left(ConditionalFormats.validateConfig(kindOf(o.fields("kind").convertTo[String]), o.fields("config").asJsObject)) should include(o.fields("fragment").convertTo[String])
        }
      }
    }
  }

  "validateConfig" should {
    "treat a missing key, null and [] as no rules, on every kind" in {
      Seq("metric", "table", "collection", "chart", "timeline", "markdown").foreach { k =>
        ConditionalFormats.validateConfig(kindOf(k), JsObject.empty) shouldBe Right(())
        ConditionalFormats.validateConfig(kindOf(k), cfg(JsNull)) shouldBe Right(())
        ConditionalFormats.validateConfig(kindOf(k), cfg(JsArray())) shouldBe Right(())
      }
    }
    "accept exactly 20 rules and reject 21" in {
      def many(c: Int) = cfg(JsArray((1 to c).map(i => rule("op" -> s("gt"), "value" -> n(i), "tone" -> s("success"))).toVector))
      ConditionalFormats.validateConfig(OutputKind.Metric, many(20)) shouldBe Right(())
      left(ConditionalFormats.validateConfig(OutputKind.Metric, many(21))) should include("at most 20")
    }
    "accept every operator and tone" in {
      Seq("gt", "gte", "lt", "lte", "eq", "neq").foreach(op => withField("op", s(op)) shouldBe Right(()))
      Seq("success", "warning", "error").foreach(t => withField("tone", s(t)) shouldBe Right(()))
      ConditionalFormats.validateConfig(OutputKind.Metric, cfg(JsArray(rule("op" -> s("between"), "value" -> n(1), "value2" -> n(1), "tone" -> s("error"))))) shouldBe Right(())
    }
    "name the FIRST offending rule's index" in {
      val msg = left(ConditionalFormats.validateConfig(OutputKind.Metric, cfg(JsArray(rule(base: _*), rule("op" -> s("nope"), "value" -> n(1), "tone" -> s("error")), rule("tone" -> s("nope"))))))
      msg should startWith("conditionalFormats[1]:")
    }
    "reject a non-number value for a numeric operator, including numeric text" in {
      left(withField("value", s("5"))) should include("conditionalFormats[0]: value must be a finite number")
      left(withField("value", JsNull)) should include("value must be a finite number")
      left(without("value")) should include("value must be a finite number")
    }
    "require a numeric, ordered value2 only for between" in {
      val b = (v2: Option[JsValue], v: BigDecimal) =>
        ConditionalFormats.validateConfig(OutputKind.Metric, cfg(JsArray(rule((Seq[(String, JsValue)]("op" -> s("between"), "value" -> n(v), "tone" -> s("error")) ++ v2.map("value2" -> _)): _*))))
      b(None, 1) .left.getOrElse("") should include("value2 is required")
      b(Some(s("2")), 1).left.getOrElse("") should include("value2")
      b(Some(n(1)), 2).left.getOrElse("") should include("value must be <= value2")
      b(Some(n(2)), 2) shouldBe Right(())
      left(withField("value2", n(2))) should include("value2 is only allowed")
    }
    "accept text for eq/neq (trimmed 1..200) and reject blank, too long, and non-scalar" in {
      withField("op", s("eq")) shouldBe Right(())
      ConditionalFormats.validateConfig(OutputKind.Metric, cfg(JsArray(rule("op" -> s("eq"), "value" -> s(" failed "), "tone" -> s("error"))))) shouldBe Right(())
      ConditionalFormats.validateConfig(OutputKind.Metric, cfg(JsArray(rule("op" -> s("neq"), "value" -> s("x" * 200), "tone" -> s("error"))))) shouldBe Right(())
      Seq[JsValue](s(""), s("   "), s("x" * 201), JsTrue, JsArray(), JsNull).foreach { v =>
        left(ConditionalFormats.validateConfig(OutputKind.Metric, cfg(JsArray(rule("op" -> s("eq"), "value" -> v, "tone" -> s("error")))))) should include("conditionalFormats[0]: value must be")
      }
    }
    "validate label (1..60 trimmed) and treat null as absent" in {
      withField("label", s("x" * 60)) shouldBe Right(())
      withField("label", JsNull) shouldBe Right(())
      left(withField("label", s("x" * 61))) should include("label must be")
      left(withField("label", s(" "))) should include("label must be")
      left(withField("label", n(1))) should include("label must be")
    }
    "reject unknown rule keys and non-object rules" in {
      left(withField("colour", s("red"))) should include("unknown key")
      left(ConditionalFormats.validateConfig(OutputKind.Metric, cfg(JsArray(JsNull)))) should include("rule must be an object")
    }
    "require a column on table rules, forbid column/target on metric and collection, and validate target" in {
      left(ConditionalFormats.validateConfig(OutputKind.Table, cfg(JsArray(rule(base: _*))))) should include("column is required")
      left(withField("column", s(""), "table")) should include("column is required")
      left(withField("column", s("  "), "table")) should include("column is required")
      withField("column", s("a"), "table") shouldBe Right(())
      left(withField("column", s("a"), "collection")) should include("column is only allowed on table")
      left(withField("target", s("row"), "collection")) should include("target is only allowed on table")
      left(withField("target", s("row"))) should include("target is only allowed on table")
      withField("column", JsNull, "metric") shouldBe Right(())
      val tbl = ConditionalFormats.validateConfig(OutputKind.Table, cfg(JsArray(rule((base.toMap + ("column" -> s("a")) + ("target" -> s("column"))).toSeq: _*))))
      left(tbl) should include("target must be")
      ConditionalFormats.validateConfig(OutputKind.Table, cfg(JsArray(rule((base.toMap + ("column" -> s("a")) + ("target" -> s("row"))).toSeq: _*)))) shouldBe Right(())
    }
    "reject a non-array, non-null value" in {
      Seq[JsValue](s("x"), n(1), JsTrue, JsObject.empty).foreach { v =>
        left(ConditionalFormats.validateConfig(OutputKind.Metric, cfg(v))) should include("conditionalFormats must be")
      }
    }
    "ignore the key on kinds that do not support it (the known-key check owns that rejection)" in {
      ConditionalFormats.validateConfig(OutputKind.Chart, cfg(s("garbage"))) shouldBe Right(())
    }
  }
}
