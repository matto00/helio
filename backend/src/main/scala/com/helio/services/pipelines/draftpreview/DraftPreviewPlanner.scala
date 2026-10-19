package com.helio.services.pipelines.draftpreview

import com.helio.api.protocols.pipelines.{DraftPreviewRequest, DraftPreviewStepDef}
import com.helio.api.protocols.pipelines.DraftPreviewLine.{DraftPreviewUnavailableLine, Reason}
import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model.PipelineStep
import com.helio.domain.steps.{AnalyzeWithAiStep, GenerateTextStep, JoinStep, LookupStep, SecondaryInput, UnionStep, UpsertSourceStep}
import com.helio.services.ServiceError

/** What the draft preview will walk and what it already knows it will not.
 *  @param unavailable  one line per enabled step that is not evaluated, in request order
 *  @param excluded     every step id (enabled or not) kept out of the walk
 *  @param walkSteps    the steps to hand the engine, with stand-ins swapped in
 *  @param rowsStepId   the step the final `rows` line reports, resolved over the full request */
final case class DraftPreviewPlan(
    unavailable: Vector[DraftPreviewUnavailableLine],
    excluded: Set[String],
    walkSteps: Vector[PipelineStep],
    rowsStepId: Option[String]
)

/** HEL-1630 design.md D1/D3: the pure half of the preview. Marks, before any evaluation, every step that must not run
 *  (an AI step, a secondary that was not supplied completely, a lane that was not supplied) and everything that depends
 *  on one through a parent or a lane edge, so a walked step never references a removed node. */
object DraftPreviewPlanner {

  private val AiKinds = Set(AnalyzeWithAiStep.Kind, GenerateTextStep.Kind)

  def plan(req: DraftPreviewRequest, decoded: Vector[PipelineStep]): Either[ServiceError, DraftPreviewPlan] = {
    val swapped = decoded.map(swapStandIn)
    validateGraph(swapped).map { _ =>
      val byId       = decoded.map(s => s.id.value -> s).toMap
      val enabledIds = decoded.filter(_.enabled).map(_.id.value).toSet
      val laneIds    = req.lanes.keySet ++ byId.keySet

      val aiSeeds = decoded.filter(s => s.enabled && AiKinds.contains(s.kind)).map(_.id.value).toSet
      val otherReasons: Map[String, String] = decoded.iterator.filter(s => s.enabled && !aiSeeds.contains(s.id.value)).flatMap { s =>
        secondaryOf(s).flatMap {
          case SecondaryInput.Source(dsId) if !req.sources.get(dsId).exists(_.complete) => Some(s.id.value -> Reason.SourceNotSupplied)
          case SecondaryInput.Lane(laneId) if !laneIds.contains(laneId)                  => Some(s.id.value -> Reason.LaneNotSupplied)
          case _                                                                          => None
        }
      }.toMap

      val aiBelow    = InProcessPipelineEngine.dependentsClosure(swapped, aiSeeds)
      val otherBelow = InProcessPipelineEngine.dependentsClosure(swapped, otherReasons.keySet)
      val excluded   = aiSeeds ++ otherReasons.keySet ++ aiBelow ++ otherBelow

      def reasonOf(id: String): String =
        if (aiSeeds.contains(id)) Reason.AiStep
        else if (aiBelow.contains(id)) Reason.DownstreamOfAiStep
        else otherReasons.getOrElse(id, Reason.DownstreamOfUnavailable)

      DraftPreviewPlan(
        unavailable = req.steps.map(_.id).filter(id => excluded.contains(id) && enabledIds.contains(id)).map(id => DraftPreviewUnavailableLine(id, reasonOf(id))),
        excluded = excluded,
        walkSteps = swapped.filterNot(s => excluded.contains(s.id.value)),
        rowsStepId = req.rowsStepId.orElse(trunkTerminal(req))
      )
    }
  }

  /** The `secondaryInput` of a join, union or lookup. */
  private def secondaryOf(step: PipelineStep): Option[SecondaryInput] = step match {
    case j: JoinStep   => Some(j.config.secondaryInput)
    case u: UnionStep  => Some(u.config.secondaryInput)
    case l: LookupStep => Some(l.config.secondaryInput)
    case _             => None
  }

  /** A disabled step is transparent whatever its kind; an enabled `upsertsource` must neither read its target nor record a
   *  write. */
  private def swapStandIn(step: PipelineStep): PipelineStep =
    if (!step.enabled) DraftIdentityStep.standingIn(step, enabled = false)
    else if (step.kind == UpsertSourceStep.Kind) DraftIdentityStep.standingIn(step, enabled = true)
    else step

  /** `400` for a parent cycle or a lane that names a step's own ancestor or the step itself, which the engine would reject
   *  after the response had already started. A lane naming a step outside the request is not an error here: it is either a
   *  supplied frame or an `unavailable` line. */
  private def validateGraph(steps: Vector[PipelineStep]): Either[ServiceError, Unit] = {
    val byId = steps.map(s => s.id.value -> s).toMap
    def ancestors(s: PipelineStep): Set[String] = {
      var seen = Set.empty[String]
      var cur  = s.parentStepId.map(_.value)
      while (cur.exists(p => !seen.contains(p))) {
        seen += cur.get
        cur = byId.get(cur.get).flatMap(_.parentStepId.map(_.value))
      }
      seen
    }
    val ancestorLane = steps.find { s =>
      InProcessPipelineEngine.laneDependencyOf(s).exists(dep => dep == s.id.value || ancestors(s).contains(dep))
    }
    if (ancestorLane.isDefined) Left(ServiceError.BadRequest("A step cannot take its own ancestor, or itself, as a lane input"))
    else {
      val deps    = steps.map(s => s.id.value -> (s.parentStepId.map(_.value).toSet ++ InProcessPipelineEngine.laneDependencyOf(s).filter(byId.contains)))
      var done    = Set.empty[String]
      var pending = deps
      var moved   = true
      while (moved && pending.nonEmpty) {
        val (ready, rest) = pending.partition { case (_, d) => d.subsetOf(done) }
        moved = ready.nonEmpty
        done = done ++ ready.map(_._1)
        pending = rest
      }
      if (pending.nonEmpty) Left(ServiceError.BadRequest("Step parents and lane inputs form a cycle")) else Right(())
    }
  }

  /** The default `rowsStepId`: from `roots[0]`, the lowest-position parentless step, then each node's lowest-position
   *  child. `None` when `roots[0]` has no step (the final line then reports the root frame itself). */
  private def trunkTerminal(req: DraftPreviewRequest): Option[String] = {
    def lowest(children: Vector[DraftPreviewStepDef]): Option[DraftPreviewStepDef] = children.sortBy(_.position).headOption
    var cur: Option[DraftPreviewStepDef] = lowest(req.steps.filter(s => s.parentStepId.isEmpty && s.rootId.contains(req.roots.head.id)))
    var last: Option[String]             = None
    var guard                            = 0
    while (cur.isDefined && guard <= req.steps.size) {
      last = cur.map(_.id)
      cur = lowest(req.steps.filter(_.parentStepId.contains(cur.get.id)))
      guard += 1
    }
    last
  }
}
