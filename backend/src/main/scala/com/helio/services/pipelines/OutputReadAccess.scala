package com.helio.services.pipelines

import com.helio.domain.model.{AuthenticatedUser, OutputId}
import com.helio.infrastructure.persistence.pipelines.OutputRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1639: "which pipeline is this Output on, if the caller can read it". An Output is readable by its pipeline's owner or
 *  any grantee (editor or viewer), the same rule `OutputService.findById` states. Used for hints that name the pipeline (an
 *  Output id passed as a pipeline root, a dashboard panel's `outputPipelineId`), where naming it to a stranger would leak
 *  that the Output exists. */
private[services] object OutputReadAccess {

  /** ACL: `findByIdInternal` bypasses RLS to learn the Output's pipeline; the answer is released only when
   *  `PipelineService.findSummaryById`, whose predicate is explicit in SQL (owner, or a grant row for the caller, not RLS alone),
   *  confirms the caller can read that pipeline. Any failure or a null collaborator (a fixture) reads as "not readable". */
  def readablePipelineId(outputRepo: OutputRepository, pipelineService: PipelineService, id: OutputId, user: AuthenticatedUser)(
      implicit ec: ExecutionContext
  ): Future[Option[String]] =
    if (outputRepo == null || pipelineService == null) Future.successful(None)
    else
      outputRepo.findByIdInternal(id).flatMap {
        case None => Future.successful(None)
        case Some(output) =>
          pipelineService.findSummaryById(output.node.pipelineId, user).map(_.toOption.map(_ => output.node.pipelineId.value))
      }.recover { case _ => None }
}
