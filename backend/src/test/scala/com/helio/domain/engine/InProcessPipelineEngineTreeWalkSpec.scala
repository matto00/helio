package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, DataSourceId, PipelineId, PipelineStep, PipelineStepId, TruncationSink, UserId}
import com.helio.domain.steps.{FilterCondition, FilterConfig, FilterStep, RenameConfig, RenameStep, StringOpsConfig, StringOpsStep}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-905 (P1.2): the tree-walk engine's own coverage -- parity for tail-free pipelines
 *  (AC1/design.md Decision 9), tail-from-parent-frame semantics (AC2/Decision 2), the Phase-1
 *  `InvalidGraph` pre-flight (AC/Decision 8), and the disabled-step in-place splice (Decision 7).
 *  Separate from the pre-existing 2600+ line `InProcessPipelineEngineSpec` (source-loading /
 *  step-evaluation coverage) -- this file is scoped to the new tree-walk contract only. */
class InProcessPipelineEngineTreeWalkSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val fileSystem = new LocalFileSystem(Paths.get("/"))
  private val engine     = new InProcessPipelineEngine(fileSystem)
  private val stepRepo   = new PipelineStepRepository(null)(ec)
  private val dsRepo     = new DataSourceRepository(null)(ec)
  private val pipelineId = PipelineId("pipe-tree")
  private val now        = Instant.now()

  private def rename(id: String, from: String, to: String, position: Int, parent: Option[String] = None, enabled: Boolean = true): RenameStep =
    RenameStep(PipelineStepId(id), pipelineId, position, RenameConfig(Map(from -> to)), now, now, parent.map(PipelineStepId(_)), enabled)

  private def filterEq(id: String, field: String, value: String, position: Int, parent: Option[String]): FilterStep =
    FilterStep(
      PipelineStepId(id), pipelineId, position,
      FilterConfig("and", Vector(FilterCondition(field, "=", Some(value)))),
      now, now, parent.map(PipelineStepId(_))
    )

  private def run(steps: Vector[PipelineStep], rows: Seq[Map[String, Any]] = Seq(Map("name" -> "alice"), Map("name" -> "bob"))) =
    Await.result(
      engine.executeTree(rows, steps, stepRepo, dsRepo, new AssertionSink, new TruncationSink),
      5.seconds
    )

  "executeTree" should {
    "be byte-identical to executeWithStepCounts for a tail-free (pure trunk) pipeline (AC1)" in {
      val steps = Vector(rename("s1", "name", "renamed", 0))
      val treeResult = run(steps)
      val (flatRows, flatCounts) = Await.result(
        engine.executeWithStepCounts(Seq(Map("name" -> "alice"), Map("name" -> "bob")), steps, dsRepo),
        5.seconds
      )
      treeResult.rows shouldBe flatRows
      treeResult.stepCounts shouldBe flatCounts
    }

    // HEL-905 (evaluation-1.md CR6): the single-`rename`-step case above exercises none of the
    // paths where the two engines could actually diverge -- widen with a multi-step trunk, a
    // disabled step in that trunk, and a failing step's attribution.
    "be byte-identical to executeWithStepCounts for a multi-step trunk, including a disabled step (AC1, widened)" in {
      val steps = Vector(
        rename("s1", "name", "renamed", 0),
        rename("s2", "renamed", "skippedRename", 0, parent = Some("s1"), enabled = false),
        filterEq("s3", "renamed", "alice", 0, parent = Some("s2"))
      )
      val treeResult = run(steps)
      // `executeWithStepCounts` itself has no notion of "disabled" -- the OLD engine's disabled
      // -step semantics lived entirely in the caller's `.filter(_.enabled)` pre-filter (removed
      // from `PipelineRunService` per Decision 7, but still the correct comparator here: a
      // disabled step is transparent, i.e. equivalent to never having been in the step list).
      val (flatRows, flatCounts) = Await.result(
        engine.executeWithStepCounts(Seq(Map("name" -> "alice"), Map("name" -> "bob")), steps.filter(_.enabled), dsRepo),
        5.seconds
      )
      treeResult.rows shouldBe flatRows
      // The disabled step (s2) gets no stepCounts entry under the tree walk (Decision 7/CR5),
      // matching the flat fold's pre-filtered-away absence exactly.
      treeResult.stepCounts.keySet should not contain "s2"
      treeResult.stepCounts("s1") shouldBe flatCounts("s1")
      treeResult.stepCounts("s3") shouldBe flatCounts("s3")
    }

    "attribute a failing step identically (step id, kind, and message) between executeTree and executeWithStepCounts (AC1, widened)" in {
      // A `stringops` `regexExtract` with no `pattern` fails `requiredConfigProblems` before
      // either engine even calls `step.evaluate` -- the exact same synchronous-throw-to-
      // StepExecutionException path both engines share via `evalOneStep` (design.md Decision 9).
      val badStep = StringOpsStep(
        PipelineStepId("bad"), pipelineId, 0,
        StringOpsConfig("regexExtract", "name", "extracted", None, None, None, None),
        now, now, None
      )
      val treeEx = intercept[StepExecutionException] { run(Vector(badStep)) }
      val flatEx = intercept[StepExecutionException] {
        Await.result(engine.executeWithStepCounts(Seq(Map("name" -> "alice")), Vector(badStep), dsRepo), 5.seconds)
      }
      treeEx.stepId shouldBe flatEx.stepId
      treeEx.stepKind shouldBe flatEx.stepKind
      treeEx.getMessage shouldBe flatEx.getMessage
    }

    "evaluate a tail from its parent node's frame, not the trunk's continuation frame" in {
      // s1 (rename name->renamed) -> trunk child s2 (rename renamed->finalName)
      //                            -> tail t1 (filter renamed == "alice")
      val s1 = rename("s1", "name", "renamed", 0)
      val s2 = rename("s2", "renamed", "finalName", 0, parent = Some("s1"))
      val t1 = filterEq("t1", "renamed", "alice", 1, parent = Some("s1"))
      val result = run(Vector(s1, s2, t1))

      // Trunk's terminal frame carries "finalName", never "renamed" (s2 ran after s1).
      result.rows shouldBe Seq(Map("finalName" -> "alice"), Map("finalName" -> "bob"))
      // The tail evaluated from s1's OWN frame (which still has "renamed"), not from s2's
      // output (which no longer has that field) -- proving parent-frame seeding.
      result.nodeOutcomes(Some("t1")).rows shouldBe Seq(Map("renamed" -> "alice"))
    }

    "record a NodeOutcome for the pipeline root and every trunk node" in {
      val s1 = rename("s1", "name", "renamed", 0)
      val result = run(Vector(s1))
      result.nodeOutcomes.keySet should contain(None)
      result.nodeOutcomes.keySet should contain(Some("s1"))
      result.nodeOutcomes(None).rows shouldBe Seq(Map("name" -> "alice"), Map("name" -> "bob"))
    }

    // HEL-905 (evaluation-1.md CR2): a two-step tail records a NodeOutcome for EVERY node in the
    // chain, not merely its terminal node -- an Output on the mid-tail node needs its own frame.
    "record a NodeOutcome for every node in a multi-step tail chain, not just the terminal one" in {
      val s1 = rename("s1", "name", "renamed", 0)
      val midTail = filterEq("mid", "renamed", "alice", 1, parent = Some("s1"))
      val terminalTail = rename("terminal", "renamed", "finalName", 0, parent = Some("mid"))
      val result = run(Vector(s1, midTail, terminalTail))

      result.nodeOutcomes.keySet should contain(Some("mid"))
      result.nodeOutcomes.keySet should contain(Some("terminal"))
      result.nodeOutcomes(Some("mid")).rows shouldBe Seq(Map("renamed" -> "alice"))
      result.nodeOutcomes(Some("terminal")).rows shouldBe Seq(Map("finalName" -> "alice"))
    }

    "reject a node with two position-0 children with a named InvalidGraph, never evaluating a step" in {
      val s1 = rename("s1", "name", "a", 0)
      val s2 = rename("s2", "name", "b", 0, parent = Some("s1"))
      val s3 = rename("s3", "name", "c", 0, parent = Some("s1"))
      val ex = intercept[InvalidGraph] { run(Vector(s1, s2, s3)) }
      ex.message should include("has 2 children at position 0")
    }

    "reject a tail node with a position>=1 child of its own" in {
      val s1 = rename("s1", "name", "a", 0)
      val tailRoot = rename("t1", "name", "b", 1, parent = Some("s1"))
      val illegalGrandchild = rename("t2", "name", "c", 1, parent = Some("t1"))
      val ex = intercept[InvalidGraph] { run(Vector(s1, tailRoot, illegalGrandchild)) }
      ex.message should include("is a tail with 1 children at position >= 1")
    }

    "skip a disabled trunk step in place, chain unbroken" in {
      val s1 = rename("s1", "name", "renamed", 0, enabled = false)
      val s2 = rename("s2", "renamed", "finalName", 0, parent = Some("s1"))
      val result = run(Vector(s1, s2))
      // s1 disabled: "renamed" never appears; s2 looks for "renamed" (absent), so its own
      // rename never fires either -- but the CHAIN was not broken (s2 still ran on s1's
      // pass-through frame, proving trunk continuation survived the disabled node).
      result.rows shouldBe Seq(Map("name" -> "alice"), Map("name" -> "bob"))
      result.nodeOutcomes(Some("s1")).rows shouldBe Seq(Map("name" -> "alice"), Map("name" -> "bob"))
    }

    "skip a disabled node with a tail child, tail evaluates from the pass-through frame" in {
      val s1 = rename("s1", "name", "renamed", 0, enabled = false)
      val t1 = filterEq("t1", "name", "alice", 1, parent = Some("s1"))
      val result = run(Vector(s1, t1))
      result.nodeOutcomes(Some("t1")).rows shouldBe Seq(Map("name" -> "alice"))
    }
  }
}
