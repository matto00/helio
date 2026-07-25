package com.helio.domain

import com.helio.api.protocols.PipelineStepConfigCodec
import com.helio.domain.shapes.TopNShape
import com.helio.domain.steps.{LimitConfig, LimitStep, SortConfig, SortStep}
import com.helio.infrastructure.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-394 — end-to-end coverage proving `TopNShape.expand`'s output actually executes to the
 *  correct top/bottom N rows through the real engine (spec.md "top-n expansion is valid against
 *  the existing step decode path", scenario "expansion executes to the correct top-N rows"), and
 *  that the default `"strict"` ties policy breaks a boundary tie by original input order (spec.md
 *  "top-n ties are broken deterministically by original input order"). Mirrors
 *  `SingleRowShapeEngineSpec`'s `makeStep`/`run` pattern, narrowed to `sort`/`limit`. */
class TopNShapeEngineSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val fileSystem                    = new LocalFileSystem(Paths.get("/"))
  private val engine                        = new InProcessPipelineEngine(fileSystem)

  /** Build a typed PipelineStep from (kind, configJson) by round-tripping through the codec —
   *  mirrors `SingleRowShapeEngineSpec.makeStep`, narrowed to the step kinds this spec exercises. */
  private def makeStep(kind: String, config: JsObject): PipelineStep = {
    val now = Instant.now()
    val cfg = PipelineStepConfigCodec.decode(kind, config.compactPrint).get
    val id  = PipelineStepId("step-id")
    val pid = PipelineId("pipe-id")
    cfg match {
      case c: SortConfig  => SortStep(id, pid, 0, c, now, now)
      case c: LimitConfig => LimitStep(id, pid, 0, c, now, now)
      case other => throw new MatchError("Unexpected config type for this spec: " + other.getClass.getName)
    }
  }

  private def run(rows: Seq[Map[String, Any]], steps: PipelineStep*): Seq[Map[String, Any]] =
    Await.result(engine.execute(rows, steps.toSeq, null), 5.seconds)

  "TopNShape expansion" should {

    "runs through the engine to the correct top-N rows sorted by measure/direction" in {
      val source: Seq[Map[String, Any]] = (1 to 10).map(i => Map("name" -> s"row-$i", "score" -> i.toDouble))

      val params      = JsObject("measure" -> JsString("score"), "direction" -> JsString("desc"), "n" -> JsNumber(3))
      val expansions  = TopNShape.expand(params).getOrElse(fail("expected Right"))
      val steps       = expansions.map(exp => makeStep(exp.kind, exp.config))

      val result = run(source, steps: _*)

      result should have size 3
      result.map(_("name")) shouldBe Seq("row-10", "row-9", "row-8")
    }

    "runs through the engine to the correct bottom-N rows when direction is asc" in {
      val source: Seq[Map[String, Any]] = (1 to 10).map(i => Map("name" -> s"row-$i", "score" -> i.toDouble))

      val params     = JsObject("measure" -> JsString("score"), "direction" -> JsString("asc"), "n" -> JsNumber(3))
      val expansions = TopNShape.expand(params).getOrElse(fail("expected Right"))
      val steps      = expansions.map(exp => makeStep(exp.kind, exp.config))

      val result = run(source, steps: _*)

      result should have size 3
      result.map(_("name")) shouldBe Seq("row-1", "row-2", "row-3")
    }

    "keeps the earlier-input row when two rows are tied at the N/N+1 boundary (strict ties)" in {
      // 3 rows, n=2, direction=desc: "second" and "third" are tied on score=5, straddling the
      // N/N+1 boundary. SortStep's stable sort preserves their original relative order, so
      // "second" (earlier in the input) is kept and "third" is dropped.
      val source: Seq[Map[String, Any]] = Seq(
        Map("name" -> "first",  "score" -> 10.0),
        Map("name" -> "second", "score" -> 5.0),
        Map("name" -> "third",  "score" -> 5.0)
      )

      val params     = JsObject("measure" -> JsString("score"), "direction" -> JsString("desc"), "n" -> JsNumber(2))
      val expansions = TopNShape.expand(params).getOrElse(fail("expected Right"))
      val steps      = expansions.map(exp => makeStep(exp.kind, exp.config))

      val result = run(source, steps: _*)

      result should have size 2
      result.map(_("name")) shouldBe Seq("first", "second")
    }
  }
}
