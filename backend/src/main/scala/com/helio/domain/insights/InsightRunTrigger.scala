package com.helio.domain.insights

import com.helio.domain.model.{PipelineId, PipelineRunId}

import java.util.UUID
import scala.concurrent.Future

/** HEL-1743 D1: the one seam the run path calls after a real run's `succeeded` event is published. The run path depends
 *  on this trait only, never on a model client; [[InsightRunTrigger.NoOp]] is the default, so a fixture that wires no
 *  insights pays nothing. The returned future is for tests: the run path never awaits it. */
trait InsightRunTrigger {
  def afterRunSucceeded(pipelineId: PipelineId, runId: PipelineRunId): Future[Unit]
}

object InsightRunTrigger {
  val NoOp: InsightRunTrigger = new InsightRunTrigger {
    override def afterRunSucceeded(pipelineId: PipelineId, runId: PipelineRunId): Future[Unit] = Future.unit
  }
}

/** HEL-1743 D10: published in-process when a render is accepted and stored (the HEL-919 delivery seam). */
final case class InsightRendered(outputId: String, pipelineId: String, recordId: UUID)

trait InsightRenderedListener {
  def onRendered(event: InsightRendered): Unit
}
