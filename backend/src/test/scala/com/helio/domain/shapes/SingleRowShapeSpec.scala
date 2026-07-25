package com.helio.domain.shapes

import com.helio.api.protocols.{CreatePipelineStepRequest, PipelineStepConfigCodec}
import com.helio.domain.steps.{AggregateConfig, AggregateStep, Aggregation, FilterCondition, FilterConfig, FilterStep, LimitConfig, LimitStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.util.Success

/** HEL-393 — `SingleRowShape.expand` coverage (spec.md "single-row shape reduces a source to
 *  exactly one row" / "single-row shape declares an exactly-one-row output contract") plus the AC3
 *  cross-check that both modes' expansions are valid against the existing step decode path
 *  (spec.md "single-row expansion is valid against the existing step decode path"). */
class SingleRowShapeSpec extends AnyWordSpec with Matchers {

  "SingleRowShape.expand (aggregate mode)" should {

    "return Right with one aggregate ShapeStepExpansion for valid params" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total")))
      )
      val result = SingleRowShape.expand(params)

      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions should have size 1
      expansions.head.kind shouldBe AggregateStep.Kind
      expansions.head.config.convertTo[AggregateConfig] shouldBe
        AggregateConfig(Vector.empty, Vector(Aggregation("total", "sum", "amount")))
    }

    "return Left with a descriptive message when \"mode\" is missing" in {
      val result = SingleRowShape.expand(JsObject.empty)
      result.isLeft shouldBe true
      result.left.getOrElse("") should not be empty
    }

    "return Left with a descriptive message when \"mode\" is unknown" in {
      val result = SingleRowShape.expand(JsObject("mode" -> JsString("unknown")))
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("unknown")
    }

    "return Left when \"measures\" is missing" in {
      val result = SingleRowShape.expand(JsObject("mode" -> JsString("aggregate")))
      result.isLeft shouldBe true
    }

    "return Left when \"measures\" is present but empty" in {
      val params = JsObject("mode" -> JsString("aggregate"), "measures" -> JsArray())
      SingleRowShape.expand(params).isLeft shouldBe true
    }

    "return Right when a measure's \"fn\" is uppercase (case-insensitive validation, HEL-394)" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(JsObject("fn" -> JsString("SUM"), "field" -> JsString("amount"), "alias" -> JsString("total")))
      )
      val result = SingleRowShape.expand(params)
      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions.head.config.convertTo[AggregateConfig] shouldBe
        AggregateConfig(Vector.empty, Vector(Aggregation("total", "SUM", "amount")))
    }

    "return Left when a measure's \"fn\" is not a supported aggregation function" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(JsObject("fn" -> JsString("median"), "field" -> JsString("amount"), "alias" -> JsString("total")))
      )
      val result = SingleRowShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("median")
    }

    "return Left when a measure's \"fn\" is not a string (malformed item, decoded via Try not thrown)" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(JsObject("fn" -> JsNumber(1), "field" -> JsString("amount"), "alias" -> JsString("total")))
      )
      // Must not throw DeserializationException — expand catches the malformed item and returns Left.
      noException should be thrownBy SingleRowShape.expand(params)
      SingleRowShape.expand(params).isLeft shouldBe true
    }

    "return Left when two measures share the same alias" in {
      val params = JsObject(
        "mode" -> JsString("aggregate"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total")),
          JsObject("fn" -> JsString("count"), "field" -> JsString("id"), "alias" -> JsString("total"))
        )
      )
      val result = SingleRowShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("total")
    }

    "return Left when a measure has an empty field or alias" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(JsObject("fn" -> JsString("sum"), "field" -> JsString(""), "alias" -> JsString("total")))
      )
      SingleRowShape.expand(params).isLeft shouldBe true
    }
  }

  "SingleRowShape.expand (filter mode)" should {

    "return Right with filter then limit-1 ShapeStepExpansions for valid params" in {
      val params = JsObject(
        "mode"       -> JsString("filter"),
        "conditions" -> JsArray(JsObject("field" -> JsString("id"), "operator" -> JsString("="), "value" -> JsString("42")))
      )
      val result = SingleRowShape.expand(params)

      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions should have size 2
      expansions(0).kind shouldBe FilterStep.Kind
      expansions(0).config.convertTo[FilterConfig] shouldBe
        FilterConfig("AND", Vector(FilterCondition("id", "=", Some("42"))))
      expansions(1).kind shouldBe LimitStep.Kind
      expansions(1).config.convertTo[LimitConfig] shouldBe LimitConfig(1)
    }

    "honor an explicit, case-insensitive \"combinator\"" in {
      val params = JsObject(
        "mode"       -> JsString("filter"),
        "combinator" -> JsString("or"),
        "conditions" -> JsArray(
          JsObject("field" -> JsString("a"), "operator" -> JsString("="), "value" -> JsString("1")),
          JsObject("field" -> JsString("b"), "operator" -> JsString("="), "value" -> JsString("2"))
        )
      )
      val result = SingleRowShape.expand(params).getOrElse(fail("expected Right"))
      result.head.config.convertTo[FilterConfig].combinator shouldBe "OR"
    }

    "return Left when \"conditions\" is missing" in {
      SingleRowShape.expand(JsObject("mode" -> JsString("filter"))).isLeft shouldBe true
    }

    "return Left when \"conditions\" is present but empty" in {
      val params = JsObject("mode" -> JsString("filter"), "conditions" -> JsArray())
      SingleRowShape.expand(params).isLeft shouldBe true
    }

    "return Left when a condition's \"operator\" is unsupported" in {
      val params = JsObject(
        "mode"       -> JsString("filter"),
        "conditions" -> JsArray(JsObject("field" -> JsString("id"), "operator" -> JsString("between"), "value" -> JsString("1")))
      )
      val result = SingleRowShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("between")
    }

    "return Left when \"combinator\" is neither \"AND\" nor \"OR\"" in {
      val params = JsObject(
        "mode"       -> JsString("filter"),
        "combinator" -> JsString("XOR"),
        "conditions" -> JsArray(JsObject("field" -> JsString("id"), "operator" -> JsString("="), "value" -> JsString("1")))
      )
      SingleRowShape.expand(params).isLeft shouldBe true
    }

    "return Left when a condition has an empty field" in {
      val params = JsObject(
        "mode"       -> JsString("filter"),
        "conditions" -> JsArray(JsObject("field" -> JsString(""), "operator" -> JsString("="), "value" -> JsString("1")))
      )
      SingleRowShape.expand(params).isLeft shouldBe true
    }
  }

  "SingleRowShape.outputContract" should {

    "declare ExactlyOne row count with empty fields" in {
      SingleRowShape.outputContract.rowCount shouldBe RowCountContract.ExactlyOne
      SingleRowShape.outputContract.fields shouldBe empty
    }
  }

  "SingleRowShape's expansion" should {

    "decode successfully through PipelineStepConfigCodec for aggregate mode (AC3)" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total")))
      )
      val expansions = SingleRowShape.expand(params).getOrElse(fail("expected Right"))

      expansions.foreach { expansion =>
        val createRequest = CreatePipelineStepRequest(expansion.kind, expansion.config)
        val decoded = PipelineStepConfigCodec.decode(createRequest.`type`, createRequest.config.compactPrint)
        decoded shouldBe a[Success[_]]
      }
    }

    "decode successfully through PipelineStepConfigCodec for filter mode (AC3)" in {
      val params = JsObject(
        "mode"       -> JsString("filter"),
        "conditions" -> JsArray(JsObject("field" -> JsString("id"), "operator" -> JsString("="), "value" -> JsString("42")))
      )
      val expansions = SingleRowShape.expand(params).getOrElse(fail("expected Right"))
      expansions should have size 2

      expansions.foreach { expansion =>
        val createRequest = CreatePipelineStepRequest(expansion.kind, expansion.config)
        val decoded = PipelineStepConfigCodec.decode(createRequest.`type`, createRequest.config.compactPrint)
        decoded shouldBe a[Success[_]]
      }
    }
  }
}
