package com.helio.services.pipelines.draftpreview

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1630: a step that passes its input through, standing in for a step the draft preview must not run as written.
 *  An enabled `upsertsource` becomes an enabled identity (a normal `step` line, no target read, nothing recorded for
 *  write-back); every disabled step becomes a disabled identity with the same id and parent, so the engine's own
 *  transparency rule applies and no disabled step keeps a lane reference or a config its lane check could trip on.
 *
 *  `kind` is deliberately not in the step registry: the engine's required-config check treats an unknown kind as having
 *  no requirements, which is right for a stand-in whose original config was never going to be evaluated. */
final case class DraftIdentityStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId],
    enabled: Boolean
) extends PipelineStep {
  val kind: String = DraftIdentityStep.Kind

  def configValue: Any = ()

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = Future.successful(rows)
}

object DraftIdentityStep {
  val Kind: String = "draftidentity"

  def standingIn(step: PipelineStep, enabled: Boolean): DraftIdentityStep =
    DraftIdentityStep(step.id, step.pipelineId, step.position, step.createdAt, step.updatedAt, step.parentStepId, enabled)
}
