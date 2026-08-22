package com.helio.domain.shapes

import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.shapes.TimeSeriesShape
import com.helio.domain.steps.{AggregateConfig, AggregateStep, DateBucketConfig, DateBucketStep, SortConfig, SortStep}
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-396 — end-to-end coverage proving `TimeSeriesShape.expand`'s output actually executes to one
 *  row per bucket, ordered chronologically, through the real engine (spec.md "time-series expansion
 *  is valid against the existing step decode path", scenario "expansion executes to one row per
 *  bucket, ordered chronologically"). Mirrors `TopNShapeEngineSpec`'s `makeStep`/`run` pattern,
 *  narrowed to `datebucket`/`aggregate`/`sort`. */
class TimeSeriesShapeEngineSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val fileSystem                    = new LocalFileSystem(Paths.get("/"))
  private val engine                        = new InProcessPipelineEngine(fileSystem)

  /** Build a typed PipelineStep from (kind, configJson) by round-tripping through the codec —
   *  mirrors `TopNShapeEngineSpec.makeStep`, narrowed to the step kinds this spec exercises. */
  private def makeStep(kind: String, config: JsObject): PipelineStep = {
    val now = Instant.now()
    val cfg = PipelineStepConfigCodec.decode(kind, config.compactPrint).get
    val id  = PipelineStepId("step-id")
    val pid = PipelineId("pipe-id")
    cfg match {
      case c: DateBucketConfig => DateBucketStep(id, pid, 0, c, now, now)
      case c: AggregateConfig  => AggregateStep(id, pid, 0, c, now, now)
      case c: SortConfig       => SortStep(id, pid, 0, c, now, now)
      case other => throw new MatchError("Unexpected config type for this spec: " + other.getClass.getName)
    }
  }

  private def run(rows: Seq[Map[String, Any]], steps: PipelineStep*): Seq[Map[String, Any]] =
    Await.result(engine.execute(rows, steps.toSeq, null), 5.seconds)

  "TimeSeriesShape expansion" should {

    "runs through the engine to one row per month, in chronological order, with correct sums" in {
      // Shuffled (non-chronological) input order spanning three distinct months — the expansion's
      // trailing sort step is what guarantees chronological output, not incidental input order.
      val source: Seq[Map[String, Any]] = Seq(
        Map("orderedAt" -> "2026-03-05", "amount" -> 10.0),
        Map("orderedAt" -> "2026-01-10", "amount" -> 5.0),
        Map("orderedAt" -> "2026-02-20", "amount" -> 20.0),
        Map("orderedAt" -> "2026-01-25", "amount" -> 15.0),
        Map("orderedAt" -> "2026-03-15", "amount" -> 30.0),
        Map("orderedAt" -> "2026-02-01", "amount" -> 8.0)
      )

      val params = JsObject(
        "timeField"   -> JsString("orderedAt"),
        "granularity" -> JsString("month"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
        )
      )
      val expansions = TimeSeriesShape.expand(params).getOrElse(fail("expected Right"))
      val steps      = expansions.map(exp => makeStep(exp.kind, exp.config))

      val result = run(source, steps: _*)

      result should have size 3
      result.map(_("orderedAt")) shouldBe Seq("2026-01-01", "2026-02-01", "2026-03-01")
      result.map(_("total")) shouldBe Seq(20.0, 28.0, 40.0)
    }
  }
}
