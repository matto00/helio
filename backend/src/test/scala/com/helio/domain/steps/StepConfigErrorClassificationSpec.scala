package com.helio.domain.steps

import com.helio.domain.engine.{InProcessPipelineEngine, StepExecutionException}
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.Try

/** HEL-1147 (design.md D1/D2, constraint C2): every D2 "config" row throws the explicit
 *  [[StepConfigError]] marker, and `StepExecutionException.isStepConfigError` reflects it.
 *
 *  Each row drives the real step's `evaluate` (so the specific throw site is the one exercised,
 *  not the engine's earlier `requiredConfigProblems` pre-check) and then wraps the failure the way
 *  the engine does. The label of each row names the D2 site, so a mutation reverting one row to a
 *  plain `IllegalArgumentException` turns exactly that row's test red. */
class StepConfigErrorClassificationSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val now = Instant.now()
  private val pid = PipelineId("p")
  private def sid = PipelineStepId("s1")

  private val rows: Seq[Map[String, Any]] = Seq(Map("name" -> "alice", "score" -> 1, "day" -> "2026-01-01"))
  private val ctx = PipelineExecutionContext(null, _ => Future.successful(Seq.empty), resolveLane = _ => Some(Seq.empty))

  /** The failure `step.evaluate` produces, whether thrown synchronously or as a failed Future. */
  private def failureOf(step: PipelineStep, input: Seq[Map[String, Any]] = rows): Throwable =
    Try(Await.result(step.evaluate(input, ctx), 5.seconds)).failed.getOrElse(fail(s"${step.kind} unexpectedly succeeded"))

  private val configRows: Seq[(String, () => PipelineStep, Seq[Map[String, Any]])] = Seq(
    ("Aggregate:96 unsupported fn (empty input, no groupBy)",
      () => AggregateStep(sid, pid, 0, AggregateConfig(Vector.empty, Vector(Aggregation("a", "bogus", "score"))), now, now), Seq.empty),
    ("Aggregate:119 unsupported fn (grouped)",
      () => AggregateStep(sid, pid, 0, AggregateConfig(Vector.empty, Vector(Aggregation("a", "bogus", "score"))), now, now), rows),
    ("Window:100 unsupported function",
      () => WindowStep(sid, pid, 0, WindowConfig(Vector.empty, Vector.empty, "bogus", None, "o", None), now, now), rows),
    ("Window:107 lag without field",
      () => WindowStep(sid, pid, 0, WindowConfig(Vector.empty, Vector.empty, "lag", None, "o", None), now, now), rows),
    ("Window:115 lag with non-positive offset",
      () => WindowStep(sid, pid, 0, WindowConfig(Vector.empty, Vector.empty, "lag", Some("score"), "o", Some(0)), now, now), rows),
    ("Pivot:81 unsupported agg",
      () => PivotStep(sid, pid, 0, PivotConfig(Vector("name"), "day", "score", "bogus"), now, now), rows),
    ("GroupBy:74 unsupported fn",
      () => GroupByStep(sid, pid, 0, GroupByConfig(Vector("name"), "score", "bogus"), now, now), rows),
    ("StringOps:100 unsupported operation",
      () => StringOpsStep(sid, pid, 0, StringOpsConfig("bogus", "name", "o", None, None, None, None), now, now), rows),
    ("StringOps:110 split without separator",
      () => StringOpsStep(sid, pid, 0, StringOpsConfig("split", "name", "o", None, None, Some(0), None), now, now), rows),
    ("StringOps:113 split without index",
      () => StringOpsStep(sid, pid, 0, StringOpsConfig("split", "name", "o", None, Some(","), None, None), now, now), rows),
    ("StringOps:118 extractRegex without pattern",
      () => StringOpsStep(sid, pid, 0, StringOpsConfig("extractRegex", "name", "o", None, None, None, None), now, now), rows),
    ("StringOps:162 extractRegex with an invalid pattern",
      () => StringOpsStep(sid, pid, 0, StringOpsConfig("extractRegex", "name", "o", Some("("), None, None, None), now, now), rows),
    ("StringOps:165 extractRegex pattern without a capturing group",
      () => StringOpsStep(sid, pid, 0, StringOpsConfig("extractRegex", "name", "o", Some("abc"), None, None, None), now, now), rows),
    ("Join:71 unsupported join type",
      () => JoinStep(sid, pid, 0, JoinConfig(SecondaryInput.Lane("x"), "name", "bogus"), now, now), rows),
    ("Union:70 unsupported mode",
      () => UnionStep(sid, pid, 0, UnionConfig(SecondaryInput.Lane("x"), "bogus"), now, now), rows),
    ("ChunkByTokenCount:107 unsupported encoding",
      () => ChunkByTokenCountStep(sid, pid, 0, ChunkByTokenCountConfig("name", encoding = "bogus"), now, now), rows),
    ("FillNull:85 unsupported strategy",
      () => FillNullStep(sid, pid, 0, FillNullConfig(Vector("name"), "bogus", None), now, now), rows),
    ("FillNull:92 constant without value",
      () => FillNullStep(sid, pid, 0, FillNullConfig(Vector("name"), "constant", None), now, now), rows),
    ("DateBucket:63 unsupported granularity",
      () => DateBucketStep(sid, pid, 0, DateBucketConfig("day", "bogus", None), now, now), rows)
  )

  "Every D2 step-configuration row" should {
    configRows.foreach { case (label, mkStep, input) =>
      s"raise StepConfigError and flag the StepExecutionException: $label" in {
        val failure = failureOf(mkStep(), input)
        failure shouldBe a[StepConfigError]
        val see = StepExecutionException.from("s1", "kind", failure)
        see.isStepConfigError shouldBe true
        see.reason shouldBe failure.getMessage
      }
    }

    "flag the engine's requiredConfigProblems branch (a compute step with an empty column)" in {
      val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/tmp")))(ec)
      val step   = ComputeStep(sid, pid, 0, ComputeConfig("", "1", None), now, now)
      val see    = intercept[StepExecutionException](Await.result(engine.execute(rows, Seq(step), null), 5.seconds))
      see.isStepConfigError shouldBe true
    }

    "flag a StepConfigTypeMismatch (re-parented onto StepConfigError)" in {
      StepExecutionException.from("s1", "k", new StepConfigTypeMismatch("'x' must be a string.")).isStepConfigError shouldBe true
    }
  }

  "StepExecutionException.isStepConfigError" should {

    "be false for a plain IllegalArgumentException (data, reference and provider failures)" in {
      val see = StepExecutionException.from("s1", "datebucket", new IllegalArgumentException("none could be parsed"))
      see.isStepConfigError shouldBe false
      see.reason shouldBe "none could be parsed"
    }

    "be false for a non-IAE fault" in {
      StepExecutionException.from("s1", "k", new RuntimeException("boom")).isStepConfigError shouldBe false
    }

    "keep the inner flag when a StepExecutionException is passed through unwrapped" in {
      val inner = StepExecutionException.from("inner", "fillnull", new StepConfigError("bad"))
      StepExecutionException.from("outer", "other", inner) should be theSameInstanceAs inner
      StepExecutionException.from("outer", "other", inner).isStepConfigError shouldBe true
      val innerPlain = StepExecutionException.from("inner", "x", new IllegalArgumentException("data"))
      StepExecutionException.from("outer", "other", innerPlain).isStepConfigError shouldBe false
    }

    "run a datebucket data failure through the engine as NOT a config error (guard)" in {
      val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/tmp")))(ec)
      val step   = DateBucketStep(sid, pid, 0, DateBucketConfig("name", "day", Some("d")), now, now)
      val see    = intercept[StepExecutionException](Await.result(engine.execute(rows, Seq(step), null), 5.seconds))
      see.isStepConfigError shouldBe false
    }
  }
}
