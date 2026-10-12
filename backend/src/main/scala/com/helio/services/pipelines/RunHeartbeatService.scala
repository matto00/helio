package com.helio.services.pipelines

import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository

import java.time.Instant
import scala.concurrent.Future

/** HEL-1511 (design.md D1): refreshes the liveness heartbeat of every run this process is executing, in one
 *  statement. [[com.helio.app.RunHeartbeatActor]] calls it on its own 30 s timer, independent of the scheduler
 *  tick (which is stalled for the length of a long scheduled run); tests call [[stampOnce]] directly. */
final class RunHeartbeatService(tracker: LiveRunTracker, runRepo: PipelineRunRepository) {

  /** Stamps `now` on the tracked runs that are still non-terminal; returns how many rows were stamped. */
  def stampOnce(now: Instant): Future[Int] = runRepo.stampHeartbeatsInternal(tracker.snapshot(), now)
}

object RunHeartbeatService {
  /** The stamping cadence. The stale bound's floor is three of these (see [[PipelineRunGuardConfig]]). */
  val IntervalSeconds: Int = 30
}
