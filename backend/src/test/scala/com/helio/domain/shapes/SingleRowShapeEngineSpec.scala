package com.helio.domain.shapes

import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.shapes.SingleRowShape
import com.helio.domain.steps._
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-393 — end-to-end coverage proving `SingleRowShape.expand`'s output actually executes to one
 *  row through the real engine (spec.md "single-row expansion is valid against the existing step
 *  decode path", scenarios "aggregate-mode expansion executes to one row" / "filter-mode expansion
 *  executes to one row"). Mirrors `InProcessPipelineEngineSpec`'s `makeStep`/`run` pattern, narrowed
 *  to the two step kinds `single-row` expands to (`aggregate`, `filter`, `limit`). */
class SingleRowShapeEngineSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val fileSystem                    = new LocalFileSystem(Paths.get("/"))
  private val engine                        = new InProcessPipelineEngine(fileSystem)

  /** Build a typed PipelineStep from (kind, configJson) by round-tripping through the codec —
   *  mirrors `InProcessPipelineEngineSpec.makeStep`, narrowed to the step kinds this spec exercises. */
  private def makeStep(kind: String, config: JsObject): PipelineStep = {
    val now = Instant.now()
    val cfg = PipelineStepConfigCodec.decode(kind, config.compactPrint).get
    val id  = PipelineStepId("step-id")
    val pid = PipelineId("pipe-id")
    cfg match {
      case c: AggregateConfig => AggregateStep(id, pid, 0, c, now, now)
      case c: FilterConfig    => FilterStep(id, pid, 0, c, now, now)
      case c: LimitConfig     => LimitStep(id, pid, 0, c, now, now)
      case other => throw new MatchError("Unexpected config type for this spec: " + other.getClass.getName)
    }
  }

  private def run(rows: Seq[Map[String, Any]], steps: PipelineStep*): Seq[Map[String, Any]] =
    Await.result(engine.execute(rows, steps.toSeq, null), 5.seconds)

  private val multiRowSource: Seq[Map[String, Any]] = Seq(
    Map("name" -> "alice", "amount" -> 10.0, "dept" -> "eng"),
    Map("name" -> "bob",   "amount" -> 25.0, "dept" -> "eng"),
    Map("name" -> "carol", "amount" -> 5.0,  "dept" -> "mkt")
  )

  "SingleRowShape aggregate-mode expansion" should {

    "runs through the engine to exactly one row containing the declared measure aliases" in {
      val params = JsObject(
        "mode" -> JsString("aggregate"),
        "measures" -> JsArray(
          JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total")),
          JsObject("fn" -> JsString("count"), "field" -> JsString("name"), "alias" -> JsString("n"))
        )
      )
      val expansions = SingleRowShape.expand(params).getOrElse(fail("expected Right"))
      val steps      = expansions.map(exp => makeStep(exp.kind, exp.config))

      val result = run(multiRowSource, steps: _*)

      result should have size 1
      result.head("total") shouldBe (10.0 + 25.0 + 5.0)
      result.head("n") shouldBe 3L
    }
  }

  "SingleRowShape filter-mode expansion" should {

    "runs through the engine to exactly one row when conditions match more than one source row" in {
      val params = JsObject(
        "mode"       -> JsString("filter"),
        "conditions" -> JsArray(JsObject("field" -> JsString("dept"), "operator" -> JsString("="), "value" -> JsString("eng")))
      )
      val expansions = SingleRowShape.expand(params).getOrElse(fail("expected Right"))
      expansions should have size 2
      val steps = expansions.map(exp => makeStep(exp.kind, exp.config))

      // "eng" matches alice and bob (2 rows) — proving limit 1 is applied after filter.
      val result = run(multiRowSource, steps: _*)

      result should have size 1
      result.head("name") shouldBe "alice"
    }
  }
}
