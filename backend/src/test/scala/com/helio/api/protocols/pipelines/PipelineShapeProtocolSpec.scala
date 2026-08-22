package com.helio.api.protocols.pipelines

import com.helio.api.protocols.pipelines.PipelineShapeProtocol
import com.helio.domain.shapes.RowCountContract
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-391 design-gate round 4 finding (skeptic-design-4.md): a sealed trait's exhaustiveness check
 *  only catches a missing-case *compile* error, not a wrong-JSON-*output* bug in a branch nothing
 *  else exercises end-to-end (the `passthrough` reference shape only ever produces `Unbounded`).
 *  This spec directly serializes all three `RowCountContract` variants through
 *  `PipelineShapeProtocol`'s JSON writer and asserts the exact wire shape for each — a first-class,
 *  non-optional task (tasks.md 5.6). */
class PipelineShapeProtocolSpec extends AnyWordSpec with Matchers with PipelineShapeProtocol {

  "rowCountContractFormat" should {

    "write ExactlyOne as {\"kind\": \"exactly-one\"} with no other keys" in {
      (RowCountContract.ExactlyOne: RowCountContract).toJson shouldBe
        JsObject("kind" -> JsString("exactly-one"))
    }

    "write AtMostParam(\"n\") as {\"kind\": \"at-most-param\", \"paramName\": \"n\"}" in {
      (RowCountContract.AtMostParam("n"): RowCountContract).toJson shouldBe
        JsObject("kind" -> JsString("at-most-param"), "paramName" -> JsString("n"))
    }

    "write Unbounded as {\"kind\": \"unbounded\"} with no other keys" in {
      (RowCountContract.Unbounded: RowCountContract).toJson shouldBe
        JsObject("kind" -> JsString("unbounded"))
    }

    "round-trip all three variants through read after write" in {
      val variants: Vector[RowCountContract] =
        Vector(RowCountContract.ExactlyOne, RowCountContract.AtMostParam("n"), RowCountContract.Unbounded)
      variants.foreach { variant =>
        variant.toJson.convertTo[RowCountContract] shouldBe variant
      }
    }
  }
}
