package com.helio.infrastructure.persistence.pipelines

import com.helio.domain._
import com.helio.domain.model._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.ExecutionContext

/** HEL-904 task 1.7 — unit coverage for `PipelineStepRepository`'s
 *  tree-ordered pure functions (`trunkOf`/`childrenOf`/`tailsOf`), added in
 *  task 1.6. These operate purely on an in-memory `Vector[PipelineStep]` via
 *  `parentStepId` (task 1.2) — no database involved, so they're exercisable
 *  before the `parent_step_id` DB column exists (task 2.2). The DB-backed
 *  splice-on-delete and sibling-scoped insert/reorder (also listed under
 *  task 1.6) require the real column and are deferred to land alongside the
 *  V94 migration (task 2.2) — see execution-progress.md. */
class PipelineStepRepositoryTreeOrderingSpec extends AnyWordSpec with Matchers {

  private val pipelineId = PipelineId("11111111-1111-1111-1111-111111111111")
  private val now        = Instant.parse("2026-08-30T00:00:00Z")

  private def step(id: String, position: Int, parent: Option[String]): PipelineStep =
    RenameStep(
      id         = PipelineStepId(id),
      pipelineId = pipelineId,
      position   = position,
      config     = RenameConfig(Map.empty),
      createdAt  = now,
      updatedAt  = now,
      enabled    = true,
      parentStepId = parent.map(PipelineStepId(_))
    )

  private val repo = new PipelineStepRepository(null)(ExecutionContext.global)

  "trunkOf" should {
    "return an empty Vector for no steps" in {
      repo.trunkOf(Vector.empty) shouldBe empty
    }

    "walk a pure trunk (every step has exactly one child) root-to-leaf" in {
      // migrated-from-position trunk: a -> b -> c
      val a = step("a", 0, None)
      val b = step("b", 0, Some("a"))
      val c = step("c", 0, Some("b"))
      repo.trunkOf(Vector(c, a, b)).map(_.id.value) shouldBe Vector("a", "b", "c")
    }

    "follow only the position-0 child at a branch point, ignoring the tail" in {
      val a    = step("a", 0, None)
      val tail = step("tail", 1, Some("a")) // branch created after a's trunk child
      val b    = step("b", 0, Some("a"))
      val c    = step("c", 0, Some("b"))
      repo.trunkOf(Vector(a, tail, b, c)).map(_.id.value) shouldBe Vector("a", "b", "c")
    }

    "degrade to a single root-level step when no parent links exist yet (pre-backfill state)" in {
      // Every real row today decodes with parentStepId = None until the V94
      // backfill (task 2.2) runs — trunkOf must not throw or loop in that state.
      val a = step("a", 0, None)
      val b = step("b", 1, None)
      repo.trunkOf(Vector(a, b)).map(_.id.value) shouldBe Vector("a")
    }

    // HEL-911 evaluation-1.md CR2 (cycle 2): two GENUINE position-0 lanes off the same
    // parent -- legal since the Phase-1 fence was deleted. `trunkOf` deliberately picks
    // ONE deterministically (documented at the method: "first position-0 child, ties
    // broken by Vector order") rather than crashing or non-deterministically alternating
    // between runs -- proven here directly, independent of the five callers that rely on
    // this determinism (PipelineService's anchor/cycle-check, PipelineRunService's
    // binary-refs key, InProcessPipelineEngine's `rows`, all documented at the method).
    "deterministically picks the first position-0 child when two genuine lanes both sit at position 0" in {
      val a  = step("a", 0, None)
      val b1 = step("b1", 0, Some("a"))
      val b2 = step("b2", 0, Some("a"))
      val r1 = repo.trunkOf(Vector(a, b1, b2)).map(_.id.value)
      val r2 = repo.trunkOf(Vector(a, b1, b2)).map(_.id.value)
      r1 shouldBe Vector("a", "b1")
      r1 shouldBe r2 // determinism: same input, same output, every call
    }
  }

  "childrenOf" should {
    "return direct children sorted by position" in {
      val a  = step("a", 0, None)
      val c1 = step("c1", 1, Some("a"))
      val c0 = step("c0", 0, Some("a"))
      repo.childrenOf(Vector(a, c1, c0), Some(PipelineStepId("a"))).map(_.id.value) shouldBe Vector("c0", "c1")
    }

    "return root-level steps for parent = None" in {
      val a = step("a", 0, None)
      val b = step("b", 1, None)
      val c = step("c", 0, Some("a"))
      repo.childrenOf(Vector(a, b, c), None).map(_.id.value) shouldBe Vector("a", "b")
    }
  }

  "tailsOf" should {
    "return no tails for a pure trunk" in {
      val a = step("a", 0, None)
      val b = step("b", 0, Some("a"))
      repo.tailsOf(Vector(a, b)) shouldBe empty
    }

    "return each non-trunk branch, expanded depth-first, as its own Vector" in {
      val a     = step("a", 0, None)
      val trunk = step("trunk", 0, Some("a"))
      val tail1 = step("tail1", 1, Some("a"))
      val tail1Child = step("tail1-child", 0, Some("tail1"))
      val tail2 = step("tail2", 2, Some("a"))

      val tails = repo.tailsOf(Vector(a, trunk, tail1, tail1Child, tail2))
      tails.map(_.map(_.id.value)) should contain theSameElementsAs Vector(
        Vector("tail1", "tail1-child"),
        Vector("tail2")
      )
    }

    // HEL-911 evaluation-1.md CR2 (cycle 2): a tail node with TWO of its own further
    // children (legal now -- the Phase-1 "no position >= 1 child below a tail" fence is
    // deleted) must not silently drop either descendant. Pre-fix, `expand`'s
    // `childrenOf(...).headOption` would follow only "grandchildA" and lose
    // "grandchildB"'s whole subtree from the returned Vector with no error at all.
    "does not drop a tail's own second child (a tail node with two further children of its own)" in {
      val a           = step("a", 0, None)
      val tail1       = step("tail1", 1, Some("a"))
      val grandchildA = step("grandchildA", 0, Some("tail1"))
      val grandchildB = step("grandchildB", 1, Some("tail1"))

      // `tailsOf`'s "one entry per tail-rooting parent" iteration means a NESTED branch
      // point (legal now; illegal pre-ticket, per the deleted second Phase-1 arm) can
      // produce more than one entry for the same node -- a pre-existing shape of this
      // helper's own algorithm, unrelated to the collapse this test guards against. What
      // CR2 requires is that no id is ever MISSING from the union of all entries; it does
      // not require the entries to be non-overlapping.
      val allIds = repo.tailsOf(Vector(a, tail1, grandchildA, grandchildB)).flatten.map(_.id.value).toSet
      allIds should contain allOf ("tail1", "grandchildA", "grandchildB")
    }
  }

  // HEL-911 (design.md Engine contract item 1): the Phase-1 "at most one position=0
  // child" fence HEL-930's `InvalidGraph` guard enforced is DELETED, not merely relaxed
  // -- two children of the same parent both at position 0 are now two ordinary lanes.
  // The property HEL-930 actually protected -- never silently drop a sibling by picking
  // one via `.find`/`.headOption` -- is re-proven below the OTHER way: both siblings
  // must appear in the returned Vector, not that an error is raised.
  "executionOrder" should {

    "includes BOTH children when a node has two position-0 children (formerly InvalidGraph), never drops one" in {
      val a  = step("a", 0, None)
      val b1 = step("b1", 0, Some("a"))
      val b2 = step("b2", 0, Some("a")) // two lanes, same parent, same position -- legal now

      val order = repo.executionOrder(Vector(a, b1, b2))
      order.map(_.id.value) should contain allOf ("b1", "b2")
    }

    "includes BOTH children when the virtual root has two position-0 children (formerly InvalidGraph), never drops one" in {
      val a1 = step("a1", 0, None)
      val a2 = step("a2", 0, None) // two root-level lanes -- legal now

      val order = repo.executionOrder(Vector(a1, a2))
      order.map(_.id.value) should contain allOf ("a1", "a2")
    }
  }
}
