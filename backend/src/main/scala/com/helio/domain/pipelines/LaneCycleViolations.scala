package com.helio.domain.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.PipelineStep

import scala.annotation.tailrec

/** HEL-1523: a stored `lane` secondary input that names its own step, one of its ancestors, or one of its
 *  descendants (parent-chain). The run could never schedule such a graph (HEL-1515), and create/update refuse to
 *  write one; this is the ONE pure implementation the trunk reorder shares, so a reorder cannot store what the
 *  other writes refuse. Direct relations only -- cycles THROUGH lane links are HEL-1521. */
object LaneCycleViolations {

  /** How `target` relates to the referencing step. */
  sealed trait Relation { def describe: String }
  case object Itself     extends Relation { val describe = "the step itself" }
  case object Ancestor   extends Relation { val describe = "its ancestor" }
  case object Descendant extends Relation { val describe = "its descendant" }

  final case class Violation(stepId: String, targetId: String, relation: Relation) {
    def key: (String, String) = (stepId, targetId)
  }

  /** Every violation among `steps` (tails included), keyed by (referencing step, lane target). */
  def of(steps: Vector[PipelineStep]): Vector[Violation] = {
    val parentOf = steps.map(s => s.id.value -> s.parentStepId.map(_.value)).toMap
    // Cycle-safe: a corrupt parent loop must not hang the walk.
    def ancestors(id: String): Set[String] = {
      @tailrec
      def loop(cur: Option[String], acc: Set[String]): Set[String] = cur match {
        case Some(p) if !acc.contains(p) && parentOf.contains(p) => loop(parentOf(p), acc + p)
        case _                                                   => acc
      }
      loop(parentOf.getOrElse(id, None), Set.empty)
    }
    steps.flatMap { s =>
      PipelineStepConfigCodec.secondaryLaneStepId(s.configValue).flatMap { target =>
        if (target == s.id.value) Some(Violation(s.id.value, target, Itself))
        else if (ancestors(s.id.value).contains(target)) Some(Violation(s.id.value, target, Ancestor))
        else if (parentOf.contains(target) && ancestors(target).contains(s.id.value)) Some(Violation(s.id.value, target, Descendant))
        else None
      }
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
