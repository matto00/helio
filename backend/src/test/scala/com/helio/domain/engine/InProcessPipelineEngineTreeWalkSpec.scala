package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, DataSourceId, PipelineId, PipelineStep, PipelineStepId, TruncationSink, UserId}
import com.helio.domain.steps.{FilterCondition, FilterConfig, FilterStep, JoinConfig, JoinStep, RenameConfig, RenameStep, SecondaryInput, StringOpsConfig, StringOpsStep, UnionConfig, UnionStep}
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

    // HEL-911 evaluation-1.md CR1 (cycle 2): `result.rows` MUST stay the TRUNK TERMINAL's
    // frame, never "whatever structuralRank visited last" -- these two shapes are exactly
    // where they diverge (structuralRank visits a node's tails AFTER its own position-0
    // continuation, so the trunk terminal's OWN tail is visited after it).

    "result.rows is the trunk terminal's frame even when the trunk terminal itself has a tail" in {
      // s1 (trunk terminal, rename name->finalName) has tail t1 hanging directly off IT
      // (not off a mid-trunk node, unlike the "evaluate a tail from its parent" test above) --
      // structuralRank visits t1 AFTER s1, so `result.rows` must still be s1's frame, not t1's.
      val s1 = rename("s1", "name", "finalName", 0)
      val t1 = filterEq("t1", "finalName", "alice", 1, parent = Some("s1"))
      val result = run(Vector(s1, t1))
      result.rows shouldBe Seq(Map("finalName" -> "alice"), Map("finalName" -> "bob"))
      result.nodeOutcomes(Some("t1")).rows shouldBe Seq(Map("finalName" -> "alice"))
    }

    "result.rows is the untouched source frame when the root has only a position>=1 child (no trunk at all)" in {
      val t1 = filterEq("t1", "name", "alice", 1, parent = None)
      val result = run(Vector(t1))
      // No position-0 root child -- trunkOf(steps) is empty, so `rows` falls back to the
      // pipeline's own source rows, exactly like pre-HEL-911 `walkTrunk(None, rows, ...)`'s
      // base case, NOT t1's (the lone lane's) filtered frame.
      result.rows shouldBe Seq(Map("name" -> "alice"), Map("name" -> "bob"))
      result.nodeOutcomes(Some("t1")).rows shouldBe Seq(Map("name" -> "alice"))
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

    // HEL-911 (design.md Engine contract item 1): the Phase-1 fence is DELETED, not merely
    // relaxed -- a node with two "position 0" children is no longer an error at all; both are
    // ordinary lanes, each evaluated independently from the parent's own frame (item 3). This
    // replaces the pre-HEL-911 `InvalidGraph`-expecting test with the behavior the contract now
    // requires: BOTH children evaluate, neither silently dropped (the HEL-930 property).
    "a node with two lane children (formerly 'two position-0 children') evaluates BOTH independently, never drops one" in {
      val s1 = rename("s1", "name", "a", 0)
      val s2 = rename("s2", "a", "b", 0, parent = Some("s1"))
      val s3 = rename("s3", "a", "c", 0, parent = Some("s1"))
      val result = run(Vector(s1, s2, s3))
      result.nodeOutcomes.keySet should contain(Some("s2"))
      result.nodeOutcomes.keySet should contain(Some("s3"))
      result.nodeOutcomes(Some("s2")).rows shouldBe Seq(Map("b" -> "alice"), Map("b" -> "bob"))
      result.nodeOutcomes(Some("s3")).rows shouldBe Seq(Map("c" -> "alice"), Map("c" -> "bob"))
    }

    // HEL-911: likewise, a "tail with a position>=1 child of its own" (previously rejected) is
    // now an ordinary lane nested another level deep -- no longer a structural violation.
    "a lane node with its own further-nested lane child (formerly rejected as an illegal tail grandchild) evaluates the whole chain" in {
      val s1 = rename("s1", "name", "a", 0)
      val tailRoot = rename("t1", "a", "b", 1, parent = Some("s1"))
      val grandchild = rename("t2", "b", "c", 1, parent = Some("t1"))
      val result = run(Vector(s1, tailRoot, grandchild))
      result.nodeOutcomes(Some("t1")).rows shouldBe Seq(Map("b" -> "alice"), Map("b" -> "bob"))
      result.nodeOutcomes(Some("t2")).rows shouldBe Seq(Map("c" -> "alice"), Map("c" -> "bob"))
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

    // HEL-911 (design.md Engine contract, tasks 11.1/11.2/11.3/11.4/11.5/11.7/11.12/11.13): the
    // multi-lane rejoin contract this ticket adds.

    "two lanes off one node evaluate independently and rejoin via union (11.1)" in {
      // root -> laneA (rename name->x) and root -> laneB (rename name->y), each a lane off the
      // virtual root; unionStep (a THIRD lane off root) rejoins laneA via lane-kind
      // secondaryInput, unioning laneA's frame onto its own (root's) frame byPosition.
      val laneA = rename("laneA", "name", "x", 0)
      val laneB = rename("laneB", "name", "y", 1)
      val unionStep = UnionStep(
        PipelineStepId("rejoin"), pipelineId, 2,
        UnionConfig(SecondaryInput.Lane("laneA"), "byPosition"),
        now, now, parentStepId = None
      )
      val result = run(Vector(laneA, laneB, unionStep))
      // unionStep evaluates from root's OWN frame (name=alice/bob) unioned with laneA's frame
      // (x=alice/bob) -- laneB (y=...) never threads in at all (lane independence, item 3).
      result.nodeOutcomes(Some("rejoin")).rows shouldBe Seq(
        Map("name" -> "alice"), Map("name" -> "bob"), Map("x" -> "alice"), Map("x" -> "bob")
      )
      result.nodeOutcomes(Some("laneB")).rows shouldBe Seq(Map("y" -> "alice"), Map("y" -> "bob"))
    }

    "join between two lanes produces the expected rows (11.2)" in {
      val laneA = rename("laneA", "name", "id", 0)
      val laneB = rename("laneB", "name", "id", 1)
      val joinStep = JoinStep(
        PipelineStepId("rejoin"), pipelineId, 0,
        JoinConfig(SecondaryInput.Lane("laneB"), "id", "inner"),
        now, now, parentStepId = Some(PipelineStepId("laneA"))
      )
      val result = run(Vector(laneA, laneB, joinStep))
      // joinStep is laneA's own child, evaluated from laneA's frame ({id: alice}/{id: bob}),
      // inner-joined on "id" against laneB's frame (also {id: alice}/{id: bob}) -- every row
      // matches itself.
      result.nodeOutcomes(Some("rejoin")).rows shouldBe Seq(Map("id" -> "alice"), Map("id" -> "bob"))
    }

    "diamond: one lane referenced by two separate rejoins is evaluated exactly once (11.3)" in {
      val shared = rename("shared", "name", "s", 0)
      val rejoinA = UnionStep(PipelineStepId("rejoinA"), pipelineId, 1, UnionConfig(SecondaryInput.Lane("shared"), "byPosition"), now, now, parentStepId = None)
      val rejoinB = UnionStep(PipelineStepId("rejoinB"), pipelineId, 2, UnionConfig(SecondaryInput.Lane("shared"), "byPosition"), now, now, parentStepId = None)
      val result = run(Vector(shared, rejoinA, rejoinB))
      result.nodeOutcomes(Some("shared")).rows shouldBe Seq(Map("s" -> "alice"), Map("s" -> "bob"))
      result.nodeOutcomes(Some("rejoinA")).rows should contain allOf (Map("s" -> "alice"), Map("s" -> "bob"))
      result.nodeOutcomes(Some("rejoinB")).rows should contain allOf (Map("s" -> "alice"), Map("s" -> "bob"))
    }

    "a lane reference to a mid-lane, non-materialized node resolves to its post-evaluation frame (11.4)" in {
      val laneRoot = rename("laneRoot", "name", "mid", 0)
      val laneNext = rename("laneNext", "mid", "final", 0, parent = Some("laneRoot"))
      val rejoin = UnionStep(PipelineStepId("rejoin"), pipelineId, 1, UnionConfig(SecondaryInput.Lane("laneRoot"), "byPosition"), now, now, parentStepId = None)
      val result = run(Vector(laneRoot, laneNext, rejoin))
      // References laneRoot (the mid-chain node), not laneNext (its own further descendant) --
      // resolves to laneRoot's OWN post-evaluation frame ("mid"), not laneNext's ("final").
      result.nodeOutcomes(Some("rejoin")).rows shouldBe Seq(Map("name" -> "alice"), Map("name" -> "bob"), Map("mid" -> "alice"), Map("mid" -> "bob"))
    }

    "a cycle (lane referencing its own ancestor) is rejected at run time (11.5, run-time arm)" in {
      val parent = rename("parent", "name", "x", 0)
      // child's parent IS "parent"; child references "parent" as its lane input -- a cycle.
      val child = UnionStep(PipelineStepId("child"), pipelineId, 0, UnionConfig(SecondaryInput.Lane("parent"), "byPosition"), now, now, parentStepId = Some(PipelineStepId("parent")))
      val ex = intercept[LaneReferenceError] { run(Vector(parent, child)) }
      ex.message should include("cycle")
    }

    "a lane reference naming a step that does not exist is rejected at run time (11.12, existence arm)" in {
      val step = UnionStep(PipelineStepId("s1"), pipelineId, 0, UnionConfig(SecondaryInput.Lane("does-not-exist"), "byPosition"), now, now, parentStepId = None)
      val ex = intercept[LaneReferenceError] { run(Vector(step)) }
      ex.message should include("does not exist")
    }

    "determinism: the same graph run twice produces identical order and counts (11.7)" in {
      val laneA = rename("laneA", "name", "x", 0)
      val laneB = rename("laneB", "name", "y", 1)
      val steps = Vector(laneA, laneB)
      val r1 = run(steps)
      val r2 = run(steps)
      r1.stepCounts shouldBe r2.stepCounts
      r1.nodeOutcomes.keySet shouldBe r2.nodeOutcomes.keySet
    }

    // HEL-911 design.md Engine contract item 9: a lane reference to a DISABLED node resolves to
    // its pass-through incoming frame -- the existing Decision 7 semantics applied unchanged.
    "a lane reference to a disabled node resolves to its pass-through incoming frame (item 9)" in {
      val disabledLane = rename("disabledLane", "name", "shouldNeverAppear", 0, enabled = false)
      val rejoin = UnionStep(PipelineStepId("rejoin"), pipelineId, 1, UnionConfig(SecondaryInput.Lane("disabledLane"), "byPosition"), now, now, parentStepId = None)
      val result = run(Vector(disabledLane, rejoin))
      // disabledLane never evaluates -- its frame is the untouched root frame (name=alice/bob).
      result.nodeOutcomes(Some("rejoin")).rows shouldBe Seq(
        Map("name" -> "alice"), Map("name" -> "bob"), Map("name" -> "alice"), Map("name" -> "bob")
      )
    }
  }
}
