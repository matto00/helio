package com.helio.domain.shapes

import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec}
import com.helio.domain.steps.{SelectConfig, SelectStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.util.Success

/** HEL-391 — `PassthroughShape.expand` coverage (spec.md "expand succeeds with valid params" /
 *  "expand rejects invalid params") plus the AC3 cross-check that an expansion is valid against
 *  the existing step decode path (spec.md "Expansion is valid against the existing step decode
 *  path"). */
class PassthroughShapeSpec extends AnyWordSpec with Matchers {

  "PassthroughShape.expand" should {

    "return Right with exactly one select ShapeStepExpansion for valid params" in {
      val params = JsObject("fields" -> JsArray(JsString("a"), JsString("b")))
      val result = PassthroughShape.expand(params)

      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions should have size 1
      expansions.head.kind shouldBe SelectStep.Kind
      expansions.head.config.convertTo[SelectConfig] shouldBe SelectConfig(Vector("a", "b"))
    }

    "return Left with a descriptive message when \"fields\" is missing" in {
      val result = PassthroughShape.expand(JsObject.empty)
      result.isLeft shouldBe true
      result.left.getOrElse("") should not be empty
    }

    "return Left when \"fields\" is present but empty" in {
      val result = PassthroughShape.expand(JsObject("fields" -> JsArray()))
      result.isLeft shouldBe true
    }

    "return Left when \"fields\" contains a non-string entry" in {
      val result = PassthroughShape.expand(JsObject("fields" -> JsArray(JsString("a"), JsNumber(1))))
      result.isLeft shouldBe true
    }
  }

  "PassthroughShape's expansion" should {

    "decode successfully through PipelineStepConfigCodec after mapping to CreatePipelineStepRequest (AC3)" in {
      val params = JsObject("fields" -> JsArray(JsString("a"), JsString("b")))
      val expansions = PassthroughShape.expand(params).getOrElse(fail("expected Right"))

      expansions.foreach { expansion =>
        val createRequest = CreatePipelineStepRequest(expansion.kind, expansion.config)
        val decoded = PipelineStepConfigCodec.decode(createRequest.`type`, createRequest.config.compactPrint)
        decoded shouldBe a[Success[_]]
        decoded.get shouldBe SelectConfig(Vector("a", "b"))
      }
    }
  }
}
