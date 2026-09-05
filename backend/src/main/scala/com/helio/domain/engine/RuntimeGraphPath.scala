package com.helio.domain.engine

import com.helio.domain.model.PipelineStep

/** HEL-914 task 6.4/6.6/D5: the runtime graph path (`root:<rootId> > s1 > s4`) — extracted
 *  verbatim from [[InProcessPipelineEngine.executeTree]]'s own local `chainToRoot`/
 *  `buildLanePath` (design.md R5/R11, HEL-913 task 6.2/6.2a) so this is genuinely the ONE
 *  implementation design.md §D5 requires ("there are exactly two address formats in this
 *  system, the request address and the runtime graph path, and each has exactly one
 *  implementation") — concise `analyze_pipeline` and the workspace-context lane tree reuse
 *  this SAME builder rather than a second, drift-prone one.
 *
 *  Walks `parentStepId` to find a step's chain AND its originating root; when the step (or,
 *  transitively, a step in its own chain) has a `lane`-kind dependency, that dependency's OWN
 *  chain is a second candidate route, because a rejoin's path built from `parentStepId` ALONE
 *  would silently ignore the lane it actually consumed. Per R5, the CANONICAL path when a node
 *  is reachable via more than one route is the one through the LOWEST-POSITIONED root (`rootIds`'s
 *  own order — the caller's responsibility to have sorted it by position ascending, R3's
 *  cross-root tiebreak). */
private[helio] object RuntimeGraphPath {

  /** One resolved builder over a fixed step set — `pathOf` is then a pure lookup, never
   *  re-walking the graph per call. */
  final class Builder private[RuntimeGraphPath] (
      byId: Map[String, PipelineStep],
      rootIds: Vector[String],
      rootIdOfStepStr: Map[String, String],
      laneDep: Map[String, Option[String]]
  ) {
    private def rootIndex(rid: String): Int = rootIds.indexOf(rid)

    private def chainToRoot(s: PipelineStep): (String, Vector[String]) = {
      def loop(cur: PipelineStep, acc: Vector[String]): (String, Vector[String]) =
        cur.parentStepId.flatMap(p => byId.get(p.value)) match {
          case Some(parent) => loop(parent, parent.id.value +: acc)
          case None         => (rootIdOfStepStr.getOrElse(cur.id.value, rootIds.headOption.getOrElse("")), acc)
        }
      loop(s, Vector(s.id.value))
    }

    /** The runtime graph path for `step`, e.g. `root:r1 > s1 > s4`. */
    def pathOf(step: PipelineStep): String = {
      val (ownRoot, ownChain) = chainToRoot(step)
      val laneCandidate: Option[(String, Vector[String])] =
        laneDep.getOrElse(step.id.value, None).flatMap(byId.get).map(chainToRoot)
      val (chosenRoot, chosenChain) = laneCandidate match {
        case Some((laneRoot, laneChain)) if rootIndex(laneRoot) >= 0 && (rootIndex(ownRoot) < 0 || rootIndex(laneRoot) < rootIndex(ownRoot)) =>
          (laneRoot, laneChain ++ ownChain)
        case _ => (ownRoot, ownChain)
      }
      (("root:" + chosenRoot) +: chosenChain).mkString(" > ")
    }

    /** Convenience overload for a caller holding only the step id (e.g. a persisted-pipeline
     *  route working from repository-shaped ids rather than domain objects it already has in
     *  hand) — `None` when the id is unknown to this builder's step set. */
    def pathOf(stepId: String): Option[String] = byId.get(stepId).map(pathOf)
  }

  /** Builds a [[Builder]] over `steps` — `rootIds` MUST already be sorted by position
   *  ascending (R3's cross-root tiebreak; every existing caller of `InProcessPipelineEngine
   *  .executeTree` already guarantees this, so this constructor does not re-sort). */
  def build(steps: Vector[PipelineStep], rootIds: Vector[String], rootIdOfStep: Map[String, String]): Builder = {
    val byId    = steps.map(s => s.id.value -> s).toMap
    val laneDep = steps.map(s => s.id.value -> InProcessPipelineEngine.laneDependencyOf(s)).toMap
    new Builder(byId, rootIds, rootIdOfStep, laneDep)
  }
}
