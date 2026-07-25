package com.helio.domain.shapes

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-391 — registry lookup coverage (spec.md "PipelineShape.Registry enumerates every registered
 *  shape"). */
class PipelineShapeSpec extends AnyWordSpec with Matchers {

  "PipelineShape.shapeFor" should {

    "return Right with the registered PassthroughShape instance for \"passthrough\"" in {
      PipelineShape.shapeFor("passthrough") shouldBe Right(PassthroughShape)
    }

    "return Left with a message listing the registered shape ids for an unknown id" in {
      val result = PipelineShape.shapeFor("does-not-exist")
      result.isLeft shouldBe true
      val message = result.left.getOrElse("")
      message should include("does-not-exist")
      message should include("passthrough")
    }
  }

  "PipelineShape.Registry" should {

    "contain exactly the passthrough shape, keyed by its id" in {
      PipelineShape.Registry shouldBe Map("passthrough" -> PassthroughShape)
    }
  }
}
