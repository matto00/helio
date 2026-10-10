package com.helio.domain.engine

import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.steps._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.RunConfigGate
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-1436: analyze/apply parity for every supported cast target, cast -> datebucket, and the stored
 *  legacy-target engine/gate behaviour. (The real run path over a CSV source is `CastPipelineRunSpec`.)
 *  RED = fails on the pre-fix tree; GUARD = preserved behaviour. */
class CastRuntimeParitySpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))
  private val dsRepo = new DataSourceRepository(null)(ec)
  private val pid    = PipelineId("p-cast")
  private val now    = Instant.now()

  private def castStep(id: String, pos: Int, casts: Map[String, String], parent: Option[String] = None): CastStep =
    CastStep(PipelineStepId(id), pid, pos, CastConfig(casts), now, now, parent.map(PipelineStepId(_)))

  private def run(rows: Seq[Map[String, Any]], steps: Vector[PipelineStep]): Seq[Map[String, Any]] =
    Await.result(engine.executeWithStepCounts(rows, steps, dsRepo), 10.seconds)._1

  private val inputs: Vector[Any] =
    Vector("1.5", "42", "true", "2026-03-14T09:30:00Z", "2026-07-01 12:00:00", "abc", "", 7, 2.5, 3L, true)

  private def familyOk(projected: String, v: Any): Boolean = (projected, v) match {
    case (_, null)                           => true
    case ("integer", _: Int | _: Long)       => true
    case ("float", _: Double)                => true
    case ("string", _: String)               => true
    case ("boolean", _: Boolean)             => true
    case ("timestamp", s: String)            => TimestampParsing.looksLikeTimestamp(s) || DateBucketStep.parsesAsDate(s)
    case _                                   => false
  }

  "analyze/apply parity" should {
    for (target <- CastStep.SupportedTargets) {
      s"RED/GUARD: every non-null '$target' cast output has the class family analyze projects" in {
        val projected = PipelineAnalyzeService
          .analyzeNodes(Vector(NodeStepInput("c", None, 0, "cast", s"""{"casts":{"v":"$target"}}""", Some("L"))), Map("L" -> Vector(SchemaField("v", "string"))))("c")
          .outputSchema.find(_.name == "v").get.`type`
        val out = CastStep.apply(inputs.map(i => Map[String, Any]("v" -> i)), CastConfig(Map("v" -> target))).map(_("v"))
        for ((in, v) <- inputs.zip(out))
          withClue(s"target=$target projected=$projected input=$in output=$v (${Option(v).map(_.getClass.getName)}): ") {
            familyOk(projected, v) shouldBe true
          }
      }
    }
  }

  "cast date feeding datebucket" should {
    "GUARD: buckets a space-separated and an epoch value to non-null dates" in {
      val rows = Seq(Map[String, Any]("when" -> "2026-07-01 12:00:00"), Map[String, Any]("when" -> "1751371200"))
      val steps = Vector[PipelineStep](
        castStep("c1", 0, Map("when" -> "date")),
        DateBucketStep(PipelineStepId("d1"), pid, 1, DateBucketConfig("when", "day", None), now, now, Some(PipelineStepId("c1")))
      )
      run(rows, steps).map(_("when")) shouldBe Seq("2026-07-01", "2025-07-01")
    }
  }

  "a stored legacy-target cast" should {
    val legacy = castStep("c1", 0, Map("doc" -> "string-body"))

    "RED: the engine passes a non-String value through unchanged" in {
      val out = run(Seq(Map[String, Any]("doc" -> 2.5), Map[String, Any]("doc" -> "hello")), Vector(legacy))
      out.map(_("doc")) shouldBe Seq(2.5, "hello")
      out.head("doc") shouldBe a[java.lang.Double]
    }

    "GUARD (C5): the scheduler/auto-run gate reports no reason for it" in {
      for (t <- Seq("string-body", "binary-ref", "foo"))
        RunConfigGate.stepConfigReasons(Vector(castStep("c1", 0, Map("doc" -> t)))) shouldBe empty
    }
  }
}
