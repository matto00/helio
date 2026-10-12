package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.CreatePipelineStepRequest
import com.helio.domain.model.{PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.services.ServiceError

/** Where a create lands, resolved from the request: `anchor` is the step the new one is spliced under (`None` =
  * root level), `explicitRootId` names the root for a root-level splice, and `attachAsTail` makes the insert a new
  * sibling that moves nothing. */
private[pipelines] final case class CreateAnchor(anchor: Option[PipelineStepId], explicitRootId: Option[PipelineRootId], attachAsTail: Boolean)

/** Pure placement and dependency helpers for step create (HEL-1515). `resolveCreateAnchor` is the one anchor
  * resolution both the insert (`PipelineStepCreate.persistNewStep`) and the lane check's descendants use, so the two
  * cannot disagree about which steps an insert re-parents. */
private[pipelines] object StepPlacement {

  /** The anchor `persistNewStep` places a create at, or the rejection it answers with. `roots` are the pipeline's
    * root ids; `trunkOf` is the repository's trunk walk. */
  def resolveCreateAnchor(
      req:          CreatePipelineStepRequest,
      steps:        Vector[PipelineStep],
      rootIdOfStep: Map[PipelineStepId, PipelineRootId],
      roots:        Vector[PipelineRootId],
      trunkOf:      Vector[PipelineStep] => Vector[PipelineStep]
  ): Either[ServiceError, CreateAnchor] =
    (req.parentStepId, req.rootId) match {
      case (Some(_), Some(_)) =>
        // HEL-913 task 7.3b: a step with a parent already has an implicit root -- naming rootId too is contradictory.
        Left(ServiceError.BadRequest("Cannot name both parentStepId and rootId -- a step with a parent inherits its root implicitly"))
      case (None, Some(rootIdRaw)) =>
        // HEL-1345: placed in THAT root's trunk, `position` an index into it (`resolveRootTrunkAnchor`).
        roots.find(_.value == rootIdRaw) match {
          case None => Left(ServiceError.UnprocessableEntity(s"rootId '$rootIdRaw' is not a root of this pipeline"))
          case Some(rootId) =>
            PipelineService.resolveRootTrunkAnchor(steps, rootIdOfStep, rootId, req.position).map { anchorOpt =>
              // `explicitRootId` only matters (and is only legal) with no parent anchor.
              CreateAnchor(anchorOpt, if (anchorOpt.isEmpty) Some(rootId) else None, attachAsTail = false)
            }
        }
      case (Some(parentStepIdRaw), None) =>
        // HEL-906 cycle 7: an explicit parentStepId takes precedence over `position`, and must belong to THIS pipeline.
        if (!steps.exists(_.id.value == parentStepIdRaw))
          Left(ServiceError.UnprocessableEntity(s"parentStepId '$parentStepIdRaw' is not a step of this pipeline"))
        else Right(CreateAnchor(Some(PipelineStepId(parentStepIdRaw)), None, req.attachAsTail.getOrElse(false)))
      case (None, None) =>
        // HEL-913 task 7.3b: neither id is unambiguous only on a single-root pipeline.
        if (roots.size > 1)
          Left(ServiceError.BadRequest(s"This pipeline has ${roots.size} roots -- name one via rootId, or anchor via parentStepId"))
        else req.position match {
          // HEL-904 cycle-9: the no-`position` default extends the TRUNK (trunk-last), not a root sibling.
          case None => Right(CreateAnchor(trunkOf(steps).lastOption.map(_.id), None, attachAsTail = false))
          case Some(index) =>
            val count = steps.size
            if (index < 0 || index > count)
              Left(ServiceError.UnprocessableEntity(s"position must be between 0 and $count (the pipeline's current step count)"))
            else Right(CreateAnchor(if (index == 0) None else Some(steps(index - 1).id), None, attachAsTail = false))
        }
    }

  /** The ids `spliceInsertReportingInternal` re-parents under the new step for `anchor`: every direct child of the
    * anchor (tails included), or -- at root level -- the named root's parentless steps (all parentless steps when no
    * root is named). Empty for a tail attach. */
  def reparentedIds(anchor: CreateAnchor, steps: Vector[PipelineStep], rootIdOfStep: Map[PipelineStepId, PipelineRootId]): Set[String] =
    if (anchor.attachAsTail) Set.empty
    else anchor.anchor match {
      case Some(a) => steps.filter(_.parentStepId.contains(a)).map(_.id.value).toSet
      case None    =>
        val parentless = steps.filter(_.parentStepId.isEmpty)
        anchor.explicitRootId
          .fold(parentless)(r => parentless.filter(s => rootIdOfStep.get(s.id).contains(r)))
          .map(_.id.value).toSet
    }
}
