package com.helio.services

import org.scalatest.concurrent.ScalaFutures
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-402 — `PipelineShapeService.expand` coverage (spec.md "POST /api/pipeline-shapes/:id/expand
 *  invokes a shape's expand function"). Service-layer only: HTTP status mapping is
 *  `PipelineShapeRoutesSpec`'s concern; this spec asserts the `ServiceError` variant chosen for each
 *  failure mode. */
class PipelineShapeServiceSpec extends AnyWordSpec with Matchers with ScalaFutures {

  private val service = new PipelineShapeService()

  "PipelineShapeService.expand" should {

    "return Right with the expanded steps for a registered shape and valid params" in {
      val params = JsObject(
        "mode"     -> JsString("aggregate"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )

      whenReady(service.expand("single-row", params)) { result =>
        result.map(_.map(_.kind)) shouldBe Right(Vector("aggregate"))
      }
    }

    "return Left(ServiceError.NotFound) for an unknown shape id" in {
      whenReady(service.expand("does-not-exist", JsObject.empty)) { result =>
        result.isLeft shouldBe true
        result.left.toOption.get shouldBe a[ServiceError.NotFound]
        result.left.toOption.get.message should include("does-not-exist")
      }
    }

    "return Left(ServiceError.UnprocessableEntity) with the shape's own message for invalid params" in {
      val params = JsObject("mode" -> JsString("aggregate"))

      whenReady(service.expand("single-row", params)) { result =>
        result.isLeft shouldBe true
        result.left.toOption.get shouldBe a[ServiceError.UnprocessableEntity]
        result.left.toOption.get.message shouldBe
          "single-row shape: missing required field 'measures' (expected a non-empty array of " +
            "{ fn, field, alias } objects) when mode is \"aggregate\""
      }
    }
  }
}
