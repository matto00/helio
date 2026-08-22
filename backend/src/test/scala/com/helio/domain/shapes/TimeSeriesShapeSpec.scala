package com.helio.domain.shapes

import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec}
import com.helio.domain.steps.{AggregateConfig, AggregateField, AggregateStep, Aggregation, DateBucketConfig, DateBucketStep, SortConfig, SortKey, SortStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.util.Success

/** HEL-396 — `TimeSeriesShape.expand` coverage (spec.md "time-series shape buckets and aggregates a
 *  time column" / "time-series shape declares an unbounded row-count output contract") plus the
 *  AC3-style cross-check that the expansion is valid against the existing step decode path
 *  (spec.md "time-series expansion is valid against the existing step decode path"). */
class TimeSeriesShapeSpec extends AnyWordSpec with Matchers {

  "TimeSeriesShape.expand" should {

    "return Right with datebucket, aggregate, then sort ShapeStepExpansions for valid params" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("month"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val result = TimeSeriesShape.expand(params)

      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions should have size 3

      expansions(0).kind shouldBe DateBucketStep.Kind
      expansions(0).config.convertTo[DateBucketConfig] shouldBe DateBucketConfig("orderedAt", "month", None)

      expansions(1).kind shouldBe AggregateStep.Kind
      expansions(1).config.convertTo[AggregateConfig] shouldBe AggregateConfig(
        Vector(AggregateField("orderedAt", "string")),
        Vector(Aggregation("total", "sum", "amount"))
      )

      expansions(2).kind shouldBe SortStep.Kind
      expansions(2).config.convertTo[SortConfig] shouldBe SortConfig(Vector(SortKey("orderedAt", "asc")))
    }

    "accept granularity case-insensitively and normalize it to lowercase" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("MONTH"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val expansions = TimeSeriesShape.expand(params).getOrElse(fail("expected Right"))
      expansions.head.config.convertTo[DateBucketConfig].granularity shouldBe "month"
    }

    "accept measure fn case-insensitively, preserving the original casing on the wire" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("day"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("SUM"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val expansions = TimeSeriesShape.expand(params).getOrElse(fail("expected Right"))
      expansions(1).config.convertTo[AggregateConfig].aggregations shouldBe
        Vector(Aggregation("total", "SUM", "amount"))
    }

    "return Left when \"timeField\" is missing" in {
      val params = JsObject(
        "granularity" -> JsString("day"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      TimeSeriesShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"timeField\" is empty" in {
      val params = JsObject(
        "timeField"   -> JsString(""),
        "granularity" -> JsString("day"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      TimeSeriesShape.expand(params).isLeft shouldBe true
    }

    "return Left with a descriptive message when \"granularity\" is unknown" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("fortnight"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val result = TimeSeriesShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("fortnight")
    }

    "return Left when \"granularity\" is missing" in {
      val params = JsObject(
        "timeField" -> JsString("orderedAt"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      TimeSeriesShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"measures\" is missing" in {
      val params = JsObject("timeField" -> JsString("orderedAt"), "granularity" -> JsString("day"))
      TimeSeriesShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"measures\" is empty" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("day"),
        "measures"    -> JsArray()
      )
      TimeSeriesShape.expand(params).isLeft shouldBe true
    }

    "return Left with a descriptive message when a measure \"fn\" is unsupported" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("day"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("median"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val result = TimeSeriesShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("median")
    }

    "return Left when two measures share the same alias" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("day"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total")),
          JsObject("fn" -> JsString("avg"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val result = TimeSeriesShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("total")
    }

    "return Left naming the collision when a measure alias equals timeField" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("day"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("orderedAt"))
        )
      )
      val result = TimeSeriesShape.expand(params)
      result.isLeft shouldBe true
      val message = result.left.getOrElse("")
      message should include("orderedAt")
    }
  }

  "TimeSeriesShape.outputContract" should {

    "declare Unbounded row count" in {
      TimeSeriesShape.outputContract.rowCount shouldBe RowCountContract.Unbounded
    }
  }

  "TimeSeriesShape's expansion" should {

    "decode successfully through PipelineStepConfigCodec (AC3)" in {
      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("month"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val expansions = TimeSeriesShape.expand(params).getOrElse(fail("expected Right"))
      expansions should have size 3

      expansions.foreach { expansion =>
        val createRequest = CreatePipelineStepRequest(expansion.kind, expansion.config)
        val decoded        = PipelineStepConfigCodec.decode(createRequest.`type`, createRequest.config.compactPrint)
        decoded shouldBe a[Success[_]]
      }
    }
  }
}
