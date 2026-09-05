package com.helio.domain.engine

import com.helio.domain.model.{PipelineId, PipelineStepId}
import com.helio.domain.steps.{RenameConfig, RenameStep, SecondaryInput, UnionConfig, UnionStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** HEL-970 (design.md D2, task 2.6): direct unit coverage of the shared dependency-closure
 *  helper that replaces the two byte-identical `pathToRoot` copies in `PipelineRunService`.
 *  Pure, in-memory `PipelineStep` construction -- no DB required, mirroring
 *  `InProcessPipelineEngineTreeWalkSpec`'s style for engine-level fixtures. */
class NodeDependencyClosureSpec extends AnyWordSpec with Matchers {

  private val pipelineId = PipelineId("pipe-1")
  private val now        = Instant.now()

  private def rename(id: String, parent: Option[String]): RenameStep =
    RenameStep(PipelineStepId(id), pipelineId, 0, RenameConfig(Map.empty), now, now, parent.map(PipelineStepId(_)))

  private def unionLane(id: String, laneStepId: String, parent: Option[String]): UnionStep =
    UnionStep(PipelineStepId(id), pipelineId, 0, UnionConfig(SecondaryInput.Lane(laneStepId), "byPosition"), now, now, parent.map(PipelineStepId(_)))

  "NodeDependencyClosure.closureOf" should {

    "for a parent-only chain (no lane edges), the closure is exactly the ancestor chain" in {
      val a = rename("a", None)
      val b = rename("b", Some("a"))
      val c = rename("c", Some("b"))
      val steps = Vector(a, b, c)

      NodeDependencyClosure.closureOf(steps, c).map(_.id.value) shouldBe Vector("a", "b", "c")
    }

    // Skeptic (final gate, round 1) CR1: every other fixture in this file has the
    // lane-referenced step as a PARENTLESS node, so "follow parent edges FROM a
    // lane-discovered node" was entirely unexercised -- a `closureOf` that follows lane edges
    // but NOT parent edges from a lane-discovered node passed every other test here. This is
    // the discriminating case: the lane target (`laneTip`) has its own multi-step ancestor
    // chain (`laneRoot -> laneMid -> laneTip`), mirroring HEL-912's real rejoin-picker shape
    // (a lane offered by the picker is itself a chain, e.g. source -> filter -> compute), not
    // a bare parentless node.
    "follows parent edges FROM a lane-discovered node that itself has a multi-step ancestor chain" in {
      val a        = rename("a", None)
      val laneRoot = rename("laneRoot", None)
      val laneMid  = rename("laneMid", Some("laneRoot"))
      val laneTip  = rename("laneTip", Some("laneMid"))
      val join     = unionLane("join", "laneTip", Some("a"))
      val steps = Vector(a, laneRoot, laneMid, laneTip, join)

      NodeDependencyClosure.closureOf(steps, join).map(_.id.value).toSet shouldBe
        Set("a", "laneRoot", "laneMid", "laneTip", "join")
    }

    "follows a single lane edge, including a non-ancestor lane step" in {
      val a    = rename("a", None)          // lane A trunk
      val b    = rename("b", None)          // lane B (a sibling root-level step, NOT a's ancestor)
      val join = unionLane("join", "b", Some("a"))
      val steps = Vector(a, b, join)

      val closure = NodeDependencyClosure.closureOf(steps, join).map(_.id.value).toSet
      closure shouldBe Set("a", "b", "join")
    }

    "follows a transitive lane edge -- a lane step that itself holds a lane reference" in {
      val root       = rename("root", None)
      val laneSource = rename("laneSource", None)
      val innerJoin  = unionLane("innerJoin", "laneSource", None) // itself a lane rejoin, no ancestor
      val outerJoin  = unionLane("outerJoin", "innerJoin", Some("root"))
      val steps = Vector(root, laneSource, innerJoin, outerJoin)

      val closure = NodeDependencyClosure.closureOf(steps, outerJoin).map(_.id.value).toSet
      closure shouldBe Set("root", "laneSource", "innerJoin", "outerJoin")
    }

    "de-duplicates a lane consumed by two rejoins (a legal diamond)" in {
      val shared  = rename("shared", None)
      val rejoinA = unionLane("rejoinA", "shared", None)
      val rejoinB = unionLane("rejoinB", "shared", Some("rejoinA"))
      val steps = Vector(shared, rejoinA, rejoinB)

      val closure = NodeDependencyClosure.closureOf(steps, rejoinB)
      closure.map(_.id.value) shouldBe Vector("shared", "rejoinA", "rejoinB")
      closure.map(_.id.value).distinct shouldBe closure.map(_.id.value)
    }

    "terminates rather than hangs on a cyclic lane reference" in {
      // Two rejoins whose lane inputs reference EACH OTHER -- a cycle no write-time guard here
      // is assumed to have prevented (design.md risk "Cycles"; HEL-911 contract item 7's
      // run-time arm exists precisely because such data is assumed reachable).
      val x = UnionStep(PipelineStepId("x"), pipelineId, 0, UnionConfig(SecondaryInput.Lane("y"), "byPosition"), now, now, None)
      val y = UnionStep(PipelineStepId("y"), pipelineId, 0, UnionConfig(SecondaryInput.Lane("x"), "byPosition"), now, now, None)
      val steps = Vector(x, y)

      val closure = NodeDependencyClosure.closureOf(steps, x)
      closure.map(_.id.value).toSet shouldBe Set("x", "y")
    }

    "emits the closure in the input vector's own order, not a re-derived rank" in {
      // Deliberately out-of-topological-order input -- the closure must simply filter this
      // vector, not re-sort it (design.md D1 corollary: ordering is the engine's job).
      val a    = rename("a", None)
      val b    = rename("b", None)
      val join = unionLane("join", "b", Some("a"))
      val steps = Vector(join, b, a) // join listed FIRST despite depending on both

      NodeDependencyClosure.closureOf(steps, join).map(_.id.value) shouldBe Vector("join", "b", "a")
    }

    "excludes a sibling lane not referenced by the target" in {
      val a       = rename("a", None)
      val laneB   = rename("laneB", None)
      val laneC   = rename("laneC", None) // never referenced by anything
      val join    = unionLane("join", "laneB", Some("a"))
      val steps   = Vector(a, laneB, laneC, join)

      NodeDependencyClosure.closureOf(steps, join).map(_.id.value).toSet shouldBe Set("a", "laneB", "join")
    }
  }
}
