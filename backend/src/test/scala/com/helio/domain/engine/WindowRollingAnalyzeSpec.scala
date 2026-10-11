package com.helio.domain.engine

import com.helio.domain.engine.PipelineAnalyzeService._
import com.helio.domain.steps.{SortKey, WindowConfig, WindowStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.lang.{Double => JDouble, Integer => JInteger}

/** HEL-1316: analyze for the rolling window functions: inferred types match what apply emits, the
 *  referenced-field table covers `field`, and incomplete rolling drafts are reported. */
class WindowRollingAnalyzeSpec extends AnyWordSpec with Matchers {

  private val schema = Vector(SchemaField("day", "string"), SchemaField("v", "float"))

  private def config(extra: String) =
    s"""{"partitionBy":[],"orderBy":[{"field":"day","direction":"asc"}],"outputColumn":"out",$extra}"""

  private def analyzeOne(cfg: String) =
    analyze(Vector(PipelineStepInput(id = "s1", position = 0, op = "window", config = cfg)), schema)(0)

  private val rolling = Seq("rolling_avg", "rolling_sum", "rolling_min", "rolling_max", "rolling_count")

  "analyze" should {
    "infer integer for rolling_count and float for the other rolling functions" in {
      for (fn <- rolling) {
        val result = analyzeOne(config(s""""function":"$fn","field":"v","frameSize":3,"frameUnit":"rows""""))
        result.validationError shouldBe None
        result.outputSchema.last shouldBe SchemaField("out", if (fn == "rolling_count") "integer" else "float")
      }
    }

    "type exactly what apply emits (Int for integer, Double for float)" in {
      val rows = (1 to 4).map(i => Map[String, Any]("day" -> i, "v" -> i))
      for (fn <- rolling) {
        val inferred = analyzeOne(config(s""""function":"$fn","field":"v","frameSize":2""")).outputSchema.last.`type`
        val cfg      = WindowConfig(Vector.empty, Vector(SortKey("day", "asc")), fn, Some("v"), "out", None, Some(2), None)
        WindowStep.apply(rows, cfg).map(_("out")).foreach { value =>
          inferred match {
            case "integer" => value shouldBe a[JInteger]
            case "float"   => value shouldBe a[JDouble]
            case other     => fail(s"unexpected inferred type $other")
          }
        }
      }
    }

    "report an incomplete rolling draft once" in {
      analyzeOne(config(""""function":"rolling_avg","frameSize":3""")).validationError.getOrElse("") should include("requires 'field'")
      analyzeOne(config(""""function":"rolling_avg","field":"v"""")).validationError.getOrElse("") should include("frameSize")
      val noOrder = """{"partitionBy":[],"orderBy":[],"outputColumn":"out","function":"rolling_avg","field":"v","frameSize":3}"""
      analyzeOne(noOrder).validationError.getOrElse("") should include("orderBy")
    }

    "report an invalid frame exactly once" in {
      val err = analyzeOne(config(""""function":"rolling_avg","field":"v","frameSize":0""")).validationError.getOrElse(fail("no error"))
      err should include("1..1000")
      err.split("1\\.\\.1000").length shouldBe 2
    }
  }

  "AnalyzeSchemaWarnings.referencedFields" should {
    "include field for every rolling function" in {
      for (fn <- rolling)
        AnalyzeSchemaWarnings.referencedFields("window", config(s""""function":"$fn","field":"v","frameSize":3""")) should contain("v")
    }
  }
}
