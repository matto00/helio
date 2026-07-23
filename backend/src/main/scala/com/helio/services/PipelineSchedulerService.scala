package com.helio.services

import com.helio.domain.{AuthenticatedUser, Clock, CronSchedule, PipelineSchedule}
import com.helio.infrastructure.{PipelineRepository, PipelineRunRepository, PipelineScheduleRepository}
import org.slf4j.LoggerFactory

import java.time.Instant
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** HEL-415 — scans due `pipeline_schedules` on every tick and fires runs
 *  through the existing [[PipelineRunService.submit]] path, as the pipeline
 *  owner. Owns the restart-safe catch-up policy and the overlap guard
 *  (design.md Decision 2/3); [[com.helio.app.PipelineSchedulerActor]] is a
 *  thin timer wrapper around [[tick]] with no business logic of its own. */
final class PipelineSchedulerService(
    scheduleRepo: PipelineScheduleRepository,
    pipelineRepo: PipelineRepository,
    runRepo: PipelineRunRepository,
    pipelineRunService: PipelineRunService,
    clock: Clock
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** Same-process in-flight guard (pipeline IDs) — the fast, same-tick half
   *  of the overlap guard (design.md Decision 3). Access is synchronized to
   *  avoid a TOCTOU race between two overlapping `tick()` calls for the same
   *  pipeline (the actor never overlaps ticks in production, but a direct
   *  caller — e.g. a test — legitimately can). */
  private val inFlight = mutable.Set.empty[String]

  private def reserve(pipelineId: String): Boolean =
    inFlight.synchronized {
      if (inFlight.contains(pipelineId)) false
      else { inFlight += pipelineId; true }
    }

  private def release(pipelineId: String): Unit =
    inFlight.synchronized { inFlight -= pipelineId }

  /** One scheduler pass: list every due/needs-recompute schedule and process
   *  each independently (one schedule's failure does not block its
   *  siblings — mirrors `AlertEvaluationService`'s per-rule isolation). */
  def tick(): Future[Unit] = {
    val now = clock.now()
    scheduleRepo.listTickCandidatesInternal(now).flatMap { candidates =>
      Future.traverse(candidates)(candidate => processCandidate(candidate, now)).map(_ => ())
    }
  }

  private def processCandidate(schedule: PipelineSchedule, now: Instant): Future[Unit] =
    processOne(schedule, now).recover { case ex =>
      log.error(s"PipelineSchedulerService: unexpected failure processing schedule ${schedule.id.value}", ex)
      ()
    }

  private def processOne(schedule: PipelineSchedule, now: Instant): Future[Unit] =
    schedule.nextRunAt match {
      // Never-yet-computed (fresh `put`, or a pre-existing row on first
      // deploy of this change): compute forward from `now` and persist —
      // do not fire. This is the "skip missed, run next due" catch-up
      // policy: only one scalar `nextRunAt` is stored, so there is no
      // backlog to replay (design.md Decision 2).
      case None => recomputeOnly(schedule, now)
      // Actually due (on time, or overdue from downtime) — fire once,
      // guarded against overlap.
      case Some(_) => fireIfNotOverlapping(schedule, now)
    }

  private def recomputeOnly(schedule: PipelineSchedule, now: Instant): Future[Unit] = {
    val next = nextFireTimeLogged(schedule, now)
    scheduleRepo.updateAfterTickInternal(schedule.id, nextRunAt = next, lastRunAt = schedule.lastRunAt)
  }

  private def fireIfNotOverlapping(schedule: PipelineSchedule, now: Instant): Future[Unit] = {
    val pid = schedule.pipelineId.value
    if (!reserve(pid)) {
      log.debug("Skipping schedule {} — pipeline {} already in-flight (same-process guard)", schedule.id.value, pid)
      Future.successful(())
    } else {
      runRepo.hasActiveRunInternal(schedule.pipelineId).flatMap {
        case true =>
          release(pid)
          log.debug("Skipping schedule {} — pipeline {} has an active run (persisted guard)", schedule.id.value, pid)
          Future.successful(())
        case false =>
          fire(schedule, now).andThen { case _ => release(pid) }
      }
    }
  }

  private def fire(schedule: PipelineSchedule, now: Instant): Future[Unit] =
    pipelineRepo.findByIdInternal(schedule.pipelineId).flatMap {
      case None =>
        // Pipeline was deleted after the schedule was created (no FK-cascade
        // race window in practice — V62's FK cascades the delete — but
        // defensive against any future change to that constraint). Recompute
        // forward so a stale row doesn't re-appear as a tick candidate every
        // tick; do not fire.
        log.warn("Scheduled pipeline {} not found — skipping fire and recomputing next_run_at", schedule.pipelineId.value)
        recomputeOnly(schedule, now)
      case Some(pipeline) =>
        val owner = AuthenticatedUser(pipeline.ownerId)
        // PipelineRunService.submit's own executeRun already records a
        // pipeline-execution failure in run history (its Failure branch
        // returns a successful Future carrying Left(...)) — this `recover`
        // only guards tick() against an unexpected exception outside that
        // path (e.g. a pre-submit DB lookup failure), so bookkeeping below
        // still runs either way.
        pipelineRunService
          .submit(schedule.pipelineId, isDry = false, owner, triggerSource = TriggerSource.Scheduled)
          .transform {
            case Success(result) => Success(result)
            case Failure(ex) =>
              log.error(s"PipelineSchedulerService: submit raised unexpectedly for pipeline ${schedule.pipelineId.value}", ex)
              Success(Left(ServiceError.UnprocessableEntity("Scheduled submit failed")))
          }
          .flatMap { _ =>
            val next = nextFireTimeLogged(schedule, now)
            scheduleRepo.updateAfterTickInternal(schedule.id, nextRunAt = next, lastRunAt = Some(now))
          }
    }

  private def nextFireTimeLogged(schedule: PipelineSchedule, after: Instant): Option[Instant] = {
    val next = CronSchedule.nextFireTime(schedule.kind, schedule.expression, schedule.timezone, after)
    if (next.isEmpty)
      log.warn(
        "CronSchedule.nextFireTime returned None for schedule {} (pipeline {}, kind {}, expression '{}') — " +
          "expression is likely infeasible (e.g. a day/month combination that never occurs); " +
          "this schedule will not fire until edited",
        schedule.id.value,
        schedule.pipelineId.value,
        schedule.kind,
        schedule.expression
      )
    next
  }
}
