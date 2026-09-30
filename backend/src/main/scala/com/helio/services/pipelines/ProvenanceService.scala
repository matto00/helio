package com.helio.services.pipelines

import com.helio.domain.engine.NodeDependencyClosure
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, PipelineRootId, PipelineRunId, PipelineStep, PipelineStepId, PipelineStepKind}
import com.helio.domain.steps.{JoinStep, LookupStep, SecondaryInput, UnionStep}
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError

import java.time.Instant
import scala.annotation.tailrec
import scala.concurrent.{ExecutionContext, Future}

/** One data source feeding an Output (HEL-1206). `dataSourceId` is internal-only: the public wire type
 *  is built field by field and never copies it. */
final case class ProvenanceSource(dataSourceId: String, name: String, kind: String)

final case class ProvenanceLastRun(status: String, completedAt: Option[Instant], rowCount: Option[Long])

final case class ProvenanceAssertions(defined: Boolean, passed: Int, failed: Int, warned: Int, rootBound: Boolean)

/** The shared internal chain both response types are built from (design.md D1). */
final case class ProvenanceChain(
    outputId: String,
    pipelineId: String,
    pipelineName: String,
    sources: Vector[ProvenanceSource],
    nodePath: Vector[String],
    lastRun: Option[ProvenanceLastRun],
    assertions: ProvenanceAssertions
)

/** HEL-1206: resolves `output -> node -> pipeline -> source(s)` plus last run and check counts in a
 *  BOUNDED number of reads (design.md D6): pipeline (1), steps+root ids (1, skipped root-bound),
 *  roots (1), data sources (1), latest non-dry run (1), assertions (1, only when the node is an
 *  assert step), snapshot count (1) -- at most 7 after the Output itself is known, independent of
 *  the number of roots/steps/secondary inputs/assertions. No ACL here: callers pass an Output they
 *  have already authorized (authenticated `findById`, or the public dashboard gate). */
final class ProvenanceService(
    outputRepo: OutputRepository,
    pipelineRepo: PipelineRepository,
    stepRepo: PipelineStepRepository,
    rootRepo: PipelineRootRepository,
    dataSourceRepo: DataSourceRepository,
    runRepo: PipelineRunRepository,
    nodeSnapshotRepo: NodeSnapshotRepository
)(implicit ec: ExecutionContext) {

  /** Authenticated entry: the sharing-aware `findById` is the ACL gate (unreadable -> 404). */
  def forUser(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, ProvenanceChain]] =
    outputRepo.findById(id, user).flatMap {
      case None         => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(output) => forOutput(output).map(Right(_))
    }

  def forOutput(output: Output): Future[ProvenanceChain] = {
    val pipelineId = output.node.pipelineId
    val stepsF: Future[(Vector[PipelineStep], Map[PipelineStepId, PipelineRootId])] =
      if (output.node.stepId.isEmpty) Future.successful((Vector.empty, Map.empty))
      else stepRepo.listWithRootIdsInternal(pipelineId)

    for {
      pipelineOpt      <- pipelineRepo.findByIdInternal(pipelineId)
      stepsAndRoots    <- stepsF
      roots            <- rootRepo.listInternal(pipelineId)
      (steps, rootIds)  = stepsAndRoots
      closure           = closureFor(output, steps)
      feedingRoots      = feedingRootIds(output, closure, rootIds)
      rootSourceIds     = roots.filter(r => feedingRoots.contains(r.id)).map(_.dataSourceId.value)
      secondaryIds      = secondarySourceIds(closure)
      orderedIds        = (rootSourceIds ++ secondaryIds).distinct
      known            <- dataSourceRepo.findNameKindsInternal(orderedIds)
      lastRunOpt       <- runRepo.latestNonDryRunInternal(pipelineId)
      assertions       <- assertionsFor(output, steps, lastRunOpt.map(_.id))
      count            <- nodeSnapshotRepo.countRows(pipelineId.value, output.node.stepId.map(_.value), output.node.rootId.map(_.value))
    } yield {
      ProvenanceChain(
        outputId     = output.id.value,
        pipelineId   = pipelineId.value,
        pipelineName = pipelineOpt.map(_.name).getOrElse(""),
        // A source that no longer resolves is omitted, never a placeholder (design.md D2).
        sources      = orderedIds.flatMap(id => known.get(id).map { case (name, kind) => ProvenanceSource(id, name, kind) }),
        nodePath     = nodePath(output, steps),
        lastRun      = lastRunOpt.map(r => ProvenanceLastRun(r.status, r.completedAt, if (count > 0) Some(count) else None)),
        assertions   = assertions
      )
    }
  }

  /** Upstream closure of the output's step (parent edges + transitive lane edges), cycle-safe; empty for a root-bound Output. */
  private def closureFor(output: Output, steps: Vector[PipelineStep]): Vector[PipelineStep] =
    output.node.stepId.flatMap(sid => steps.find(_.id == sid)).map(NodeDependencyClosure.closureOf(steps, _)).getOrElse(Vector.empty)

  /** Root-bound: exactly that root. Step-bound: every parentless (trunk) step in the closure names its root. */
  private def feedingRootIds(output: Output, closure: Vector[PipelineStep], rootIds: Map[PipelineStepId, PipelineRootId]): Set[PipelineRootId] =
    output.node.rootId match {
      case Some(rid) if output.node.stepId.isEmpty => Set(rid)
      case _                                       => closure.filter(_.parentStepId.isEmpty).flatMap(s => rootIds.get(s.id)).toSet
    }

  /** `SecondaryInput.Source(dataSourceId)` names a data source directly (NOT a pipeline root); the
   *  empty-string `SecondaryInput.Default` sentinel is skipped. Closure (execution) order = discovery order. */
  private def secondarySourceIds(closure: Vector[PipelineStep]): Vector[String] =
    closure.flatMap {
      case j: JoinStep   => sourceIdOf(j.config.secondaryInput)
      case u: UnionStep  => sourceIdOf(u.config.secondaryInput)
      case l: LookupStep => sourceIdOf(l.config.secondaryInput)
      case _             => None
    }

  private def sourceIdOf(si: SecondaryInput): Option[String] = si match {
    case SecondaryInput.Source(id) if id.nonEmpty => Some(id)
    case _                                        => None
  }

  /** Step labels (a step carries no user-given name, so its `kind`) along the primary `parentStepId` chain, trunk first. */
  private def nodePath(output: Output, steps: Vector[PipelineStep]): Vector[String] = {
    val byId = steps.map(s => s.id -> s).toMap
    @tailrec
    def walk(cur: Option[PipelineStepId], acc: List[String], seen: Set[PipelineStepId]): Vector[String] =
      cur.flatMap(byId.get) match {
        case Some(step) if !seen.contains(step.id) => walk(step.parentStepId, step.kind :: acc, seen + step.id)
        case _                                     => acc.toVector
      }
    walk(output.node.stepId, Nil, Set.empty)
  }

  /** design.md D5: scoped to the output's own node, latest non-dry run; `error` failures -> failed,
   *  other failures -> warned. `observed` is never read into the chain. */
  private def assertionsFor(output: Output, steps: Vector[PipelineStep], runId: Option[String]): Future[ProvenanceAssertions] = {
    val rootBound = output.node.stepId.isEmpty
    val isAssert  = output.node.stepId.flatMap(sid => steps.find(_.id == sid)).exists(_.kind == PipelineStepKind.Assert)
    (runId, output.node.stepId) match {
      case (Some(rid), Some(sid)) if isAssert =>
        runRepo.listAssertionsByRunInternal(PipelineRunId(rid)).map { rows =>
          val own = rows.filter(_.stepId == sid.value)
          ProvenanceAssertions(
            defined   = true,
            passed    = own.count(_.passed),
            failed    = own.count(a => !a.passed && a.severity == "error"),
            warned    = own.count(a => !a.passed && a.severity != "error"),
            rootBound = false
          )
        }
      case _ => Future.successful(ProvenanceAssertions(defined = isAssert, passed = 0, failed = 0, warned = 0, rootBound = rootBound))
    }
  }
}
