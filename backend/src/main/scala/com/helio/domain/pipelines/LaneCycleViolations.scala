package com.helio.domain.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.{PipelineStep, PipelineStepId}

import scala.annotation.tailrec

/** A stored `lane` secondary input that would close a cycle in the step dependency graph. The engine schedules a
 *  step only once its parent AND its lane target are evaluated (`InProcessPipelineEngine.isReady`), so the graph has
 *  an edge `s -> parent(s)` and an edge `s -> laneTarget(s)`; a lane write `a -> t` closes a cycle exactly when `t`
 *  already depends on `a` through those edges. HEL-1523 (direct relations) and HEL-1521 (through lane links) share
 *  this ONE pure implementation: create, update, duplicate (via `LaneScope`/`validateLaneReference`) and the trunk
 *  reorder all take the relation, and every set it is computed from, from here. */
object LaneCycleViolations {

  /** How `target` relates to the referencing step. */
  sealed trait Relation { def describe: String }
  case object Itself           extends Relation { val describe = "the step itself" }
  case object Ancestor         extends Relation { val describe = "its ancestor" }
  case object Descendant       extends Relation { val describe = "its descendant" }
  case object DependentViaLane extends Relation { val describe = "a step that depends on it through a lane link" }

  final case class Violation(stepId: String, targetId: String, relation: Relation) {
    def key: (String, String) = (stepId, targetId)
  }

  /** The ids on the path back to the root starting at `parent` (inclusive), walked via `parentStepId`. Cycle-safe:
   *  a corrupt parent loop must not hang the walk. */
  def ancestorsFrom(parent: Option[PipelineStepId], steps: Vector[PipelineStep]): Set[String] = {
    val parentOf = steps.map(s => s.id.value -> s.parentStepId.map(_.value)).toMap
    @tailrec
    def loop(cur: Option[String], acc: Set[String]): Set[String] = cur match {
      case Some(p) if !acc.contains(p) && parentOf.contains(p) => loop(parentOf(p), acc + p)
      case _                                                   => acc
    }
    loop(parent.map(_.value), Set.empty)
  }

  /** Every step reachable from `seeds` through `parentStepId` (children, grandchildren, ...), INCLUDING the seeds. */
  def descendantsOf(seeds: Set[String], steps: Vector[PipelineStep]): Set[String] =
    reverseClosure(seeds, steps, followLane = false)

  /** Every step that depends on a seed -- a child of one, or a step whose lane target is one, transitively --
   *  INCLUDING the seeds. Walks reverse edges only, so a seed's own outgoing (about-to-be-replaced) lane edge is
   *  never followed. */
  def dependentsOf(seeds: Set[String], steps: Vector[PipelineStep]): Set[String] =
    reverseClosure(seeds, steps, followLane = true)

  private def reverseClosure(seeds: Set[String], steps: Vector[PipelineStep], followLane: Boolean): Set[String] = {
    val edges: Vector[(String, Set[String])] = steps.map { s =>
      val lane = if (followLane) PipelineStepConfigCodec.secondaryLaneStepId(s.configValue).toSet else Set.empty[String]
      s.id.value -> (s.parentStepId.map(_.value).toSet ++ lane)
    }
    // Visited-set walk: a corrupt/legacy cyclic graph terminates.
    @tailrec
    def expand(frontier: Set[String], acc: Set[String]): Set[String] = {
      val next = edges.collect { case (id, deps) if !acc.contains(id) && deps.exists(frontier.contains) => id }.toSet
      if (next.isEmpty) acc else expand(next, acc ++ next)
    }
    expand(seeds, seeds)
  }

  /** The ONE classifier: how lane target `target` relates to the writing step. Precedence Itself > Ancestor >
   *  Descendant > DependentViaLane (a parent-chain descendant is also a dependent and keeps the descendant relation).
   *  `dependents`/`descendants` must not contain the writing step itself. */
  def relationOf(
      target:      String,
      selfId:      Option[String],
      ancestors:   Set[String],
      descendants: Set[String],
      dependents:  Set[String]
  ): Option[Relation] =
    if (selfId.contains(target)) Some(Itself)
    else if (ancestors.contains(target)) Some(Ancestor)
    else if (descendants.contains(target)) Some(Descendant)
    else if (dependents.contains(target)) Some(DependentViaLane)
    else None

  /** Every violation among `steps` (tails included), keyed by (referencing step, lane target). */
  def of(steps: Vector[PipelineStep]): Vector[Violation] =
    steps.flatMap { s =>
      PipelineStepConfigCodec.secondaryLaneStepId(s.configValue).flatMap { target =>
        val self = s.id.value
        relationOf(
          target, Some(self),
          ancestorsFrom(s.parentStepId, steps),
          descendantsOf(Set(self), steps) - self,
          dependentsOf(Set(self), steps) - self
        ).map(Violation(self, target, _))
      }
    }

  /** Violations present in `after` that were not already present (same referencing step and target) in `before`. */
  def introduced(before: Vector[PipelineStep], after: Vector[PipelineStep]): Vector[Violation] = {
    val existing = of(before).map(_.key).toSet
    of(after).filterNot(v => existing.contains(v.key))
  }
}

/** Raised inside a reorder transaction so the relink rolls back; the service maps it to `400`. */
final class LaneCycleOnReorderException(message: String) extends RuntimeException(message)
