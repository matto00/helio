package com.helio.domain

import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.shapes.PivotMatrixShape
import com.helio.domain.steps.{AggregateConfig, AggregateStep, PivotConfig, PivotStep}
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-398 — end-to-end coverage proving `PivotMatrixShape.expand`'s output actually executes to a
 *  correct crosstab through the real engine (spec.md "pivot-matrix expansion is valid against the
 *  existing step decode path", scenarios "expansion executes to a correct crosstab with duplicate
 *  index/column pairs pre-collapsed" / "expansion executes to a correct crosstab with agg \"first\"
 *  and no pre-aggregate"). Mirrors `TimeSeriesShapeEngineSpec`'s `makeStep`/`run` pattern, narrowed
 *  to `aggregate`/`pivot`. */
class PivotMatrixShapeEngineSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val fileSystem                    = new LocalFileSystem(Paths.get("/"))
  private val engine                        = new InProcessPipelineEngine(fileSystem)

  /** Build a typed PipelineStep from (kind, configJson) by round-tripping through the codec —
   *  mirrors `TimeSeriesShapeEngineSpec.makeStep`, narrowed to the step kinds this spec exercises. */
  private def makeStep(kind: String, config: JsObject): PipelineStep = {
    val now = Instant.now()
    val cfg = PipelineStepConfigCodec.decode(kind, config.compactPrint).get
    val id  = PipelineStepId("step-id")
    val pid = PipelineId("pipe-id")
    cfg match {
      case c: AggregateConfig => AggregateStep(id, pid, 0, c, now, now)
      case c: PivotConfig     => PivotStep(id, pid, 0, c, now, now)
      case other => throw new MatchError("Unexpected config type for this spec: " + other.getClass.getName)
    }
  }

  private def run(rows: Seq[Map[String, Any]], steps: PipelineStep*): Seq[Map[String, Any]] =
    Await.result(engine.execute(rows, steps.toSeq, null), 5.seconds)

  "PivotMatrixShape expansion" should {

    "runs through the engine to a correct crosstab, pre-collapsing duplicate index/column pairs, when agg is \"sum\"" in {
      // Two rows share the (region=east, quarter=Q1) pair — the pre-aggregate step must sum them
      // (30.0 + 20.0 = 50.0) before pivot runs, rather than pivot's own "first" winning arbitrarily.
      val source: Seq[Map[String, Any]] = Seq(
        Map("region" -> "east", "quarter" -> "Q1", "revenue" -> 30.0),
        Map("region" -> "east", "quarter" -> "Q1", "revenue" -> 20.0),
        Map("region" -> "east", "quarter" -> "Q2", "revenue" -> 15.0),
        Map("region" -> "west", "quarter" -> "Q1", "revenue" -> 40.0)
      )

      val params = JsObject(
        "index"  -> JsArray(JsString("region")),
        "column" -> JsString("quarter"),
        "values" -> JsString("revenue"),
        "agg"    -> JsString("sum")
      )
      val expansions = PivotMatrixShape.expand(params).getOrElse(fail("expected Right"))
      expansions should have size 2
      val steps = expansions.map(exp => makeStep(exp.kind, exp.config))

      val result = run(source, steps: _*)

      result should have size 2
      val east = result.find(_("region") == "east").getOrElse(fail("missing east row"))
      east("revenue_Q1") shouldBe 50.0
      east("revenue_Q2") shouldBe 15.0

      val west = result.find(_("region") == "west").getOrElse(fail("missing west row"))
      west("revenue_Q1") shouldBe 40.0
      west.get("revenue_Q2") shouldBe None
    }

    "runs through the engine to a correct crosstab via pivot alone when agg is \"first\", with no pre-aggregate" in {
      val source: Seq[Map[String, Any]] = Seq(
        Map("region" -> "east", "quarter" -> "Q1", "revenue" -> 30.0),
        Map("region" -> "east", "quarter" -> "Q2", "revenue" -> 15.0),
        Map("region" -> "west", "quarter" -> "Q1", "revenue" -> 40.0)
      )

      val params = JsObject(
        "index"  -> JsArray(JsString("region")),
        "column" -> JsString("quarter"),
        "values" -> JsString("revenue"),
        "agg"    -> JsString("first")
      )
      val expansions = PivotMatrixShape.expand(params).getOrElse(fail("expected Right"))
      expansions should have size 1
      val steps = expansions.map(exp => makeStep(exp.kind, exp.config))

      val result = run(source, steps: _*)

      result should have size 2
      val east = result.find(_("region") == "east").getOrElse(fail("missing east row"))
      east("revenue_Q1") shouldBe 30.0
      east("revenue_Q2") shouldBe 15.0

      val west = result.find(_("region") == "west").getOrElse(fail("missing west row"))
      west("revenue_Q1") shouldBe 40.0
    }
  }
}
