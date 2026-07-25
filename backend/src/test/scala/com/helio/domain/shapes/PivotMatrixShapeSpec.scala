package com.helio.domain.shapes

import com.helio.api.protocols.{CreatePipelineStepRequest, PipelineStepConfigCodec}
import com.helio.domain.steps.{AggregateConfig, AggregateField, AggregateStep, Aggregation, PivotConfig, PivotStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.util.Success

/** HEL-398 — `PivotMatrixShape.expand` coverage (spec.md "pivot-matrix shape reshapes a source into
 *  a crosstab via optional pre-aggregate + pivot" / "pivot-matrix shape declares an unbounded
 *  row-count output contract") plus the AC3-style cross-check that the expansion is valid against
 *  the existing step decode path (spec.md "pivot-matrix expansion is valid against the existing
 *  step decode path"). */
class PivotMatrixShapeSpec extends AnyWordSpec with Matchers {

  private def baseParams(agg: String): JsObject = JsObject(
    "index"  -> JsArray(JsString("region")),
    "column" -> JsString("quarter"),
    "values" -> JsString("revenue"),
    "agg"    -> JsString(agg)
  )

  "PivotMatrixShape.expand" should {

    "return Right with aggregate then pivot ShapeStepExpansions when agg is \"sum\"" in {
      val result = PivotMatrixShape.expand(baseParams("sum"))

      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions should have size 2

      expansions(0).kind shouldBe AggregateStep.Kind
      expansions(0).config.convertTo[AggregateConfig] shouldBe AggregateConfig(
        Vector(AggregateField("region", "string"), AggregateField("quarter", "string")),
        Vector(Aggregation("revenue", "sum", "revenue"))
      )

      expansions(1).kind shouldBe PivotStep.Kind
      expansions(1).config.convertTo[PivotConfig] shouldBe
        PivotConfig(Vector("region"), "quarter", "revenue", "first")
    }

    "return Right with aggregate then pivot for each other reducer agg (avg/min/max/count)" in {
      Seq("avg", "min", "max", "count").foreach { agg =>
        val expansions = PivotMatrixShape.expand(baseParams(agg)).getOrElse(fail(s"expected Right for $agg"))
        expansions should have size 2
        expansions(0).kind shouldBe AggregateStep.Kind
        expansions(0).config.convertTo[AggregateConfig].aggregations shouldBe
          Vector(Aggregation("revenue", agg, "revenue"))
        expansions(1).kind shouldBe PivotStep.Kind
        expansions(1).config.convertTo[PivotConfig].agg shouldBe "first"
      }
    }

    "return Right with pivot alone when agg is \"first\"" in {
      val result = PivotMatrixShape.expand(baseParams("first"))

      result.isRight shouldBe true
      val expansions = result.getOrElse(Vector.empty)
      expansions should have size 1
      expansions.head.kind shouldBe PivotStep.Kind
      expansions.head.config.convertTo[PivotConfig] shouldBe
        PivotConfig(Vector("region"), "quarter", "revenue", "first")
    }

    "accept agg \"SUM\" case-insensitively, preserving casing in aggregate's fn and hardcoding pivot's agg" in {
      val expansions = PivotMatrixShape.expand(baseParams("SUM")).getOrElse(fail("expected Right"))
      expansions should have size 2
      expansions(0).config.convertTo[AggregateConfig].aggregations shouldBe
        Vector(Aggregation("revenue", "SUM", "revenue"))
      expansions(1).config.convertTo[PivotConfig].agg shouldBe "first"
    }

    "accept agg \"FIRST\" case-insensitively, normalizing pivot's agg to the lowercase literal" in {
      val expansions = PivotMatrixShape.expand(baseParams("FIRST")).getOrElse(fail("expected Right"))
      expansions should have size 1
      expansions.head.config.convertTo[PivotConfig].agg shouldBe "first"
    }

    "return Left when \"index\" is missing" in {
      val params = JsObject(
        "column" -> JsString("quarter"),
        "values" -> JsString("revenue"),
        "agg"    -> JsString("sum")
      )
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"index\" is empty" in {
      val params = JsObject(baseParams("sum").fields.updated("index", JsArray()))
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"index\" contains an empty string" in {
      val params = JsObject(baseParams("sum").fields.updated("index", JsArray(JsString(""))))
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"index\" contains duplicate field names" in {
      val params = JsObject(
        baseParams("sum").fields.updated("index", JsArray(JsString("region"), JsString("region")))
      )
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"column\" is missing" in {
      val params = JsObject(baseParams("sum").fields - "column")
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"column\" is empty" in {
      val params = JsObject(baseParams("sum").fields.updated("column", JsString("")))
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"values\" is missing" in {
      val params = JsObject(baseParams("sum").fields - "values")
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left when \"values\" is empty" in {
      val params = JsObject(baseParams("sum").fields.updated("values", JsString("")))
      PivotMatrixShape.expand(params).isLeft shouldBe true
    }

    "return Left with a descriptive message naming the supported set when \"agg\" is unsupported" in {
      val params = JsObject(baseParams("sum").fields.updated("agg", JsString("median")))
      val result = PivotMatrixShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("median")
    }

    "return Left naming the collision when \"column\" collides with \"index\"" in {
      val params = JsObject(
        "index"  -> JsArray(JsString("region"), JsString("quarter")),
        "column" -> JsString("quarter"),
        "values" -> JsString("revenue"),
        "agg"    -> JsString("sum")
      )
      val result = PivotMatrixShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("quarter")
    }

    "return Left naming the collision when \"values\" collides with \"index\"" in {
      val params = JsObject(
        "index"  -> JsArray(JsString("region"), JsString("revenue")),
        "column" -> JsString("quarter"),
        "values" -> JsString("revenue"),
        "agg"    -> JsString("sum")
      )
      val result = PivotMatrixShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("revenue")
    }

    "return Left naming the collision when \"values\" equals \"column\"" in {
      val params = JsObject(
        "index"  -> JsArray(JsString("region")),
        "column" -> JsString("revenue"),
        "values" -> JsString("revenue"),
        "agg"    -> JsString("sum")
      )
      val result = PivotMatrixShape.expand(params)
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("revenue")
    }
  }

  "PivotMatrixShape.outputContract" should {

    "declare Unbounded row count with empty fields and a description noting data-dependent value columns" in {
      PivotMatrixShape.outputContract.rowCount shouldBe RowCountContract.Unbounded
      PivotMatrixShape.outputContract.fields shouldBe empty
      PivotMatrixShape.outputContract.description should include("data-dependent")
    }
  }

  "PivotMatrixShape's expansion" should {

    "decode successfully through PipelineStepConfigCodec (AC3) for the two-step form" in {
      val expansions = PivotMatrixShape.expand(baseParams("sum")).getOrElse(fail("expected Right"))
      expansions should have size 2

      expansions.foreach { expansion =>
        val createRequest = CreatePipelineStepRequest(expansion.kind, expansion.config)
        val decoded        = PipelineStepConfigCodec.decode(createRequest.`type`, createRequest.config.compactPrint)
        decoded shouldBe a[Success[_]]
      }
    }

    "decode successfully through PipelineStepConfigCodec (AC3) for the one-step form" in {
      val expansions = PivotMatrixShape.expand(baseParams("first")).getOrElse(fail("expected Right"))
      expansions should have size 1

      expansions.foreach { expansion =>
        val createRequest = CreatePipelineStepRequest(expansion.kind, expansion.config)
        val decoded        = PipelineStepConfigCodec.decode(createRequest.`type`, createRequest.config.compactPrint)
        decoded shouldBe a[Success[_]]
      }
    }
  }
}
