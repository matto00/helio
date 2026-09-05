package com.helio.domain.engine

import com.helio.domain.model.PipelineStep

/** HEL-970 (design.md D1/D2): the single dependency-closure helper that replaces the two
 *  byte-identical `pathToRoot` copies formerly local to `PipelineRunService` (`previewStep` and
 *  `evaluateNodeRowsForBackfill`). `pathToRoot` walked `parentStepId` ONLY, producing a linear
 *  ancestor chain -- correct only when every node had exactly one ancestor chain (pre-HEL-911).
 *  The engine's own notion of "what must run before this node" is a dependency CLOSURE over
 *  parent edges AND lane edges (`InProcessPipelineEngine.laneDependencyOf`, transitively), which
 *  may branch and re-merge; preview must adopt that notion rather than defining its own (D1's
 *  "the engine's notion is authoritative" ruling).
 *
 *  Sited in `com.helio.domain.engine` (D2), not `com.helio.services.pipelines`, because its
 *  correctness is defined entirely by `InProcessPipelineEngine.laneDependencyOf`'s edge set --
 *  putting the helper in the service package while its predicate lives in the engine package
 *  would reproduce exactly the definitional drift that produced this ticket. Public (not
 *  `private[engine]`) so `PipelineRunService`, in a different top-level package, can call it --
 *  "at least `private[engine]`" (design.md D2) is a visibility FLOOR, not a ceiling; task 2.6's
 *  requirement (unit-test the helper directly from `com.helio.domain.engine`) is satisfied by any
 *  visibility public or wider than `private[engine]`.
 */
object NodeDependencyClosure {

  /** The transitive dependency closure of `target` within `steps`: `target` itself, every
   *  ancestor reachable by `parentStepId`, and -- for every `join`/`union`/`lookup` step already
   *  in the closure whose `secondaryInput` is `{kind: "lane", stepId}` -- that referenced node
   *  together with its own ancestors and lane dependencies, repeated to a fixed point.
   *
   *  Ordering (D1 corollary): the result is emitted in `steps`' own (repository execution)
   *  order, filtered down to the closure's membership -- NOT re-ranked or re-ordered here.
   *  `InProcessPipelineEngine.executeTree` topologically sorts whatever vector it is handed; a
   *  second ordering authority here would be able to drift from `structuralRank`. This function
   *  makes no claim about the order being a valid evaluation order on its own.
   *
   *  De-duplication (task 2.3): a step id is visited at most once (backed by a mutable `Set`),
   *  so a lane consumed by more than one rejoin (a legal diamond, HEL-911 Decision 3) appears
   *  exactly once in the result.
   *
   *  Termination (task 2.2 / design.md risk "Cycles"): the visited-set fixed-point expansion
   *  below only ever adds ids not already visited to the next frontier, so a cyclic reference
   *  (data that reached the table by some path the write-time cycle guard did not cover) cannot
   *  cause this to loop -- the frontier shrinks to empty and the loop halts.
   *
   *  Disabled steps (task 2.5 / design.md risk "Disabled nodes"): NOT pre-filtered here. A
   *  disabled lane-referenced node's passed-through incoming frame is what a rejoin reads
   *  (HEL-911 contract item 9); excluding it here would remove that frame. The engine's own
   *  in-place skip (design.md Decision 7, referenced from the pre-existing call sites) handles
   *  disabled steps at evaluation time. */
  def closureOf(steps: Vector[PipelineStep], target: PipelineStep): Vector[PipelineStep] = {
    val byId = steps.map(s => s.id.value -> s).toMap

    val visited  = scala.collection.mutable.LinkedHashSet(target.id.value)
    var frontier = Set(target.id.value)

    while (frontier.nonEmpty) {
      val next = scala.collection.mutable.Set.empty[String]
      frontier.foreach { id =>
        byId.get(id).foreach { step =>
          step.parentStepId.foreach { p =>
            if (!visited.contains(p.value)) next += p.value
          }
          InProcessPipelineEngine.laneDependencyOf(step).foreach { dep =>
            if (!visited.contains(dep)) next += dep
          }
        }
      }
      visited ++= next
      frontier = next.toSet
    }

    steps.filter(s => visited.contains(s.id.value))
  }
}
