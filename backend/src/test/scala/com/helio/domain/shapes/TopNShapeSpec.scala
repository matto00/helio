package com.helio.domain.shapes

import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec}
import com.helio.domain.steps.{LimitConfig, LimitStep, SortConfig, SortKey, SortStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.util.Success

/** HEL-394 — `TopNShape.expand` coverage (spec.md "top-n shape sorts and limits a source by a
 *  measure" / "top-n shape declares an at-most-n-rows output contract") plus the AC3-style
 *  cross-check that the expansion is valid against the existing step decode path (spec.md "top-n
 *  expansion is valid against the existing step decode path"). */
class TopNShapeSpec extends AnyWordSpec with Matchers {

  "TopNShape.expand" should {

    "return Right with sort then limit ShapeStepExpansions for valid params" in {
      val params = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("desc"), "n" -> JsNumber(5))
      val result = TopNShape.expand(params)

      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions should have size 2
      expansions(0).kind shouldBe SortStep.Kind
      expansions(0).config.convertTo[SortConfig] shouldBe SortConfig(Vector(SortKey("revenue", "desc")))
      expansions(1).kind shouldBe LimitStep.Kind
      expansions(1).config.convertTo[LimitConfig] shouldBe LimitConfig(5)
    }

    "accept direction case-insensitively, passing the original casing through unchanged" in {
      val params = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("DESC"), "n" -> JsNumber(5))
      val result = TopNShape.expand(params).getOrElse(fail("expected Right"))
      result.head.config.convertTo[SortConfig].sortBy shouldBe Vector(SortKey("revenue", "DESC"))
    }

    "return Left when \"measure\" is missing" in {
      val params = JsObject("direction" -> JsString("desc"), "n" -> JsNumber(5))
      TopNShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"measure\" is empty" in {
      val params = JsObject("measure" -> JsString(""), "direction" -> JsString("desc"), "n" -> JsNumber(5))
      TopNShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"n\" is missing" in {
      val params = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("desc"))
      TopNShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"n\" is zero" in {
      val params = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("desc"), "n" -> JsNumber(0))
      TopNShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"n\" is negative" in {
      val params = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("desc"), "n" -> JsNumber(-1))
      TopNShape.expand(params).isLeft shouldBe true
    }

    "return Left with a descriptive message when \"direction\" is unknown" in {
      val params = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("sideways"), "n" -> JsNumber(5))
      val result = TopNShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("sideways")
    }

    "return Left when \"direction\" is missing" in {
      val params = JsObject("measure" -> JsString("revenue"), "n" -> JsNumber(5))
      TopNShape.expand(params).isLeft shouldBe true
    }

    "default \"ties\" to \"strict\" when absent" in {
      val params = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("desc"), "n" -> JsNumber(5))
      TopNShape.expand(params).isRight shouldBe true
    }

    "accept an explicit \"ties\": \"strict\"" in {
      val params = JsObject(
        "measure"   -> JsString("revenue"),
        "direction" -> JsString("desc"),
        "n"         -> JsNumber(5),
        "ties"      -> JsString("strict")
      )
      TopNShape.expand(params).isRight shouldBe true
    }

    "return Left naming the window-op deferral when \"ties\" is an unsupported value" in {
      val params = JsObject(
        "measure"   -> JsString("revenue"),
        "direction" -> JsString("desc"),
        "n"         -> JsNumber(5),
        "ties"      -> JsString("keep-ties")
      )
      val result = TopNShape.expand(params)
      result.isLeft shouldBe true
      val message = result.left.getOrElse("")
      message should include("keep-ties")
      message should include("window")
    }
  }

  "TopNShape.outputContract" should {

    "declare AtMostParam(\"n\") row count" in {
      TopNShape.outputContract.rowCount shouldBe RowCountContract.AtMostParam("n")
    }
  }

  "TopNShape's expansion" should {

    "decode successfully through PipelineStepConfigCodec (AC3)" in {
      val params      = JsObject("measure" -> JsString("revenue"), "direction" -> JsString("desc"), "n" -> JsNumber(5))
      val expansions  = TopNShape.expand(params).getOrElse(fail("expected Right"))
      expansions should have size 2

      expansions.foreach { expansion =>
        val createRequest = CreatePipelineStepRequest(expansion.kind, expansion.config)
        val decoded        = PipelineStepConfigCodec.decode(createRequest.`type`, createRequest.config.compactPrint)
        decoded shouldBe a[Success[_]]
      }
    }
  }
}
