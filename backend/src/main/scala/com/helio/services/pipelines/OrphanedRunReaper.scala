package com.helio.services.pipelines

import com.helio.api.routes.pipelines.{PipelineRunRegistry, RunStatusEvent}
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository
import org.slf4j.LoggerFactory

import java.time.{Duration, Instant}
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1511 (design.md D2/D3): finalizes real runs whose executing process died. [[PipelineSchedulerService.tick]]
 *  calls [[reap]] FIRST, so a pipeline freed here fires its due schedule or pending auto-run on the same tick and
 *  the run stops holding a slot in the owner's concurrency cap. Never fails the tick.
 *
 *  Logs under the scheduler's logger name, like [[PipelineAutoRunDebounceFirer]]. */
private[pipelines] final class OrphanedRunReaper(
    runRepo: PipelineRunRepository,
    staleAfterSeconds: Long,
    // Nullable-optional like the other collaborators: a fixture that passes none simply publishes no event.
    registry: PipelineRunRegistry
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineSchedulerService])

  def reap(now: Instant): Future[Unit] =
    // Privileged (system context): the scheduler tick has no request user, and the reap must see and finalize every
    // owner's stale runs; the user pool's owner-scoped RLS would match none of them. Bypassing RLS is correct here: the
    // statement takes no caller input and only finalizes runs past the stale bound.
    runRepo
      .reapStaleRunsInternal(now, staleAfterSeconds, PipelineRunGuardConfig.LegacyRunStaleAfterSeconds, PipelineRunService.EmptyTruncationJson)
      .map(_.foreach { run =>
        log.warn(
          "Reaped abandoned run {} of pipeline {} (owner {}): started {} ago, no live heartbeat; marked failed",
          run.runId.value, run.pipelineId.value, run.ownerId.value, Duration.between(run.startedAt, now)
        )
        if (registry != null)
          registry.publish(run.pipelineId.value, RunStatusEvent("failed", errorLog = Some(run.reason), runId = Some(run.runId.value)))
      })
      .recover { case ex => log.error("PipelineSchedulerService: orphaned-run reaping failed", ex) }
}
