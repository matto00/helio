package com.helio.services.pipelines

import com.helio.domain.model.PipelineRunId

import java.util.concurrent.ConcurrentHashMap
import scala.jdk.CollectionConverters._

/** HEL-1511 (design.md D1): the ids of the real runs this process is executing right now. The executor registers a
 *  run once its row is admitted and deregisters it on every exit path; [[RunHeartbeatService]] stamps exactly this
 *  set, so a run whose process died stops being stamped and is eventually reaped. Injected (never a global): the
 *  [[PipelineRunService]] owns one and `Main` hands that same instance to the heartbeat actor. */
final class LiveRunTracker {
  private val live = ConcurrentHashMap.newKeySet[String]()

  def register(runId: PipelineRunId): Unit   = { live.add(runId.value); () }
  def deregister(runId: PipelineRunId): Unit = { live.remove(runId.value); () }

  /** A snapshot of the currently registered run ids. */
  def snapshot(): Set[String] = live.asScala.toSet
}
