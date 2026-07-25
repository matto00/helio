package com.helio.domain.shapes

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-391 — registry lookup coverage (spec.md "PipelineShape.Registry enumerates every registered
 *  shape"). HEL-393 adds the registry-parity drift test HEL-391 deferred until a second shape
 *  existed (mirrors `ConnectorRegistrySpec`'s pattern). HEL-394 extends both the parity set and the
 *  lookup coverage for the third shape, `top-n`. HEL-396 extends both again for the fourth shape,
 *  `time-series`. HEL-398 extends both again for the fifth and final shape, `pivot-matrix`. */
class PipelineShapeSpec extends AnyWordSpec with Matchers {

  // Independently authored — NOT derived from PipelineShape.Registry. If a shape is added to the
  // Registry without a matching literal here (or vice versa, e.g. a typo'd `id`), one of the
  // assertions below fails.
  private val expectedIds: Set[String] =
    Set("passthrough", "single-row", "top-n", "time-series", "pivot-matrix")

  "PipelineShape.shapeFor" should {

    "return Right with the registered PassthroughShape instance for \"passthrough\"" in {
      PipelineShape.shapeFor("passthrough") shouldBe Right(PassthroughShape)
    }

    "return Right with the registered SingleRowShape instance for \"single-row\"" in {
      PipelineShape.shapeFor("single-row") shouldBe Right(SingleRowShape)
    }

    "return Right with the registered TopNShape instance for \"top-n\"" in {
      PipelineShape.shapeFor("top-n") shouldBe Right(TopNShape)
    }

    "return Right with the registered TimeSeriesShape instance for \"time-series\"" in {
      PipelineShape.shapeFor("time-series") shouldBe Right(TimeSeriesShape)
    }

    "return Right with the registered PivotMatrixShape instance for \"pivot-matrix\"" in {
      PipelineShape.shapeFor("pivot-matrix") shouldBe Right(PivotMatrixShape)
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

    "contain exactly the passthrough, single-row, top-n, time-series, and pivot-matrix shapes, keyed by their ids" in {
      PipelineShape.Registry shouldBe Map(
        "passthrough"  -> PassthroughShape,
        "single-row"   -> SingleRowShape,
        "top-n"        -> TopNShape,
        "time-series"  -> TimeSeriesShape,
        "pivot-matrix" -> PivotMatrixShape
      )
    }

    "match the independently-authored id set, with no drift between Registry and the literal set" in {
      PipelineShape.Registry.keySet shouldBe expectedIds
      PipelineShape.Registry should have size 5
    }
  }
}
