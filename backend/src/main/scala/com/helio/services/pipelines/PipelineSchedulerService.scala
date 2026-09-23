package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.domain.model.{AuditSource, AuthenticatedUser, PipelineId, PipelineSchedule}
import com.helio.domain.util.{Clock, CronSchedule}
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRunGuardRepository, PipelineRunRepository, PipelineScheduleRepository}
import org.slf4j.LoggerFactory

import java.time.Instant
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** HEL-415 — scans due `pipeline_schedules` on every tick and fires runs
 *  through the existing [[PipelineRunService.submit]] path, as the pipeline
 *  owner. Owns the restart-safe catch-up policy and the overlap guard
 *  (design.md Decision 2/3); [[com.helio.app.PipelineSchedulerActor]] is a
 *  thin timer wrapper around [[tick]] with no business logic of its own.
 *
 *  HEL-1093 (design.md Decision 3): this same tick also claims and fires due dataset-write
 *  auto-run debounce rows -- no dedicated second timer. See [[processAutoRunDebounce]]. */
final class PipelineSchedulerService(
    scheduleRepo: PipelineScheduleRepository,
    pipelineRepo: PipelineRepository,
    runRepo: PipelineRunRepository,
    pipelineRunService: PipelineRunService,
    clock: Clock,
    // HEL-505 (design.md Decision 2, C3): nullable-optional wiring, mirrors this codebase's
    // established nullable-collaborator convention (see ApiRoutes) -- a fixture that doesn't pass
    // one simply skips the rate-window cleanup sweep below. Piggybacked on this service's existing
    // tick cadence (rather than a second timer) since a scheduler tick's own cost already
    // dominates a bounded DELETE by a wide margin.
    pipelineRunGuardRepo: PipelineRunGuardRepository = null,
    // HEL-1093 (design.md Decision 3): nullable-optional wiring mirrors pipelineRunGuardRepo
    // above -- a fixture that doesn't pass a PipelineAutoRunDebounceRepository simply skips the
    // auto-run claim-and-fire pass below.
    autoRunDebounceRepo: PipelineAutoRunDebounceRepository = null,
    // HEL-1093 (design.md Decision 3, step 1): generous self-healing fallback for a claim whose
    // owning process crashed before reaching `releaseClaim` -- chosen well above any realistic
    // `submit()` duration. Overridable so a test doesn't need to wait 5 real minutes to exercise
    // the stale-reclaim path.
    staleClaimAfterSeconds: Long = 300L
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
    val candidatesWork = scheduleRepo.listTickCandidatesInternal(now).flatMap { candidates =>
      Future.traverse(candidates)(candidate => processCandidate(candidate, now)).map(_ => ())
    }
    // HEL-505 (design.md Decision 2, C3): the pipeline-run rate-limit table's bounded cleanup,
    // piggybacked on this existing tick cadence -- run concurrently with candidate processing (an
    // unrelated table, no ordering dependency) and never allowed to fail the tick itself.
    val cleanupWork =
      if (pipelineRunGuardRepo != null)
        pipelineRunGuardRepo.cleanupOldWindows().recover { case ex =>
          log.error("PipelineSchedulerService: pipeline_run_rate_window cleanup failed", ex)
          0
        }
      else Future.successful(0)
    // HEL-1093 (design.md Decision 3): the auto-run debounce claim-and-fire pass, run
    // concurrently with the two existing pieces of work above (an unrelated table, no ordering
    // dependency) and never allowed to fail the tick itself.
    val autoRunWork = processAutoRunDebounce(now).recover { case ex =>
      log.error("PipelineSchedulerService: auto-run debounce claim-and-fire pass failed", ex)
      ()
    }
    candidatesWork.zip(cleanupWork).zip(autoRunWork).map(_ => ())
  }

  /** HEL-1093 (design.md Decision 3): claims every due `pipeline_auto_run_debounce` row and fires
   *  each one through the existing `PipelineRunService.submit` path, as the pipeline owner —
   *  mirrors `fire`'s synthetic-owner-identity pattern exactly. No-op when `autoRunDebounceRepo`
   *  is not wired (nullable-optional, mirrors `pipelineRunGuardRepo` above). */
  private def processAutoRunDebounce(now: Instant): Future[Unit] =
    if (autoRunDebounceRepo == null) Future.successful(())
    else
      autoRunDebounceRepo.claimDue(now, staleClaimAfter = now.minusSeconds(staleClaimAfterSeconds)).flatMap { claimed =>
        Future.traverse(claimed) { case (pipelineId, claimedAt) =>
          processAutoRunClaim(pipelineId, claimedAt).recover { case ex =>
            log.error(s"PipelineSchedulerService: unexpected failure processing auto-run claim for pipeline ${pipelineId.value}", ex)
            ()
          }
        }.map(_ => ())
      }

  /** Fires (unless a same-pipeline run is already active — the same narrower overlap
   *  consideration `fireIfNotOverlapping` already applies to scheduled fires, design.md Decision
   *  3 step 2) then ALWAYS releases the claim (step 4), whether fired, skipped, or guard-rejected
   *  — see `PipelineAutoRunDebounceRepository.releaseClaim`'s own doc for why an unconditional
   *  release would be wrong. */
  private def processAutoRunClaim(pipelineId: PipelineId, claimedAt: Instant): Future[Unit] =
    runRepo.hasActiveRunInternal(pipelineId).flatMap {
      case true =>
        log.debug("Skipping auto-run claim for pipeline {} — already has an active run", pipelineId.value)
        autoRunDebounceRepo.releaseClaim(pipelineId, claimedAt)
      case false =>
        fireAutoRun(pipelineId).flatMap { _ => autoRunDebounceRepo.releaseClaim(pipelineId, claimedAt) }
    }

  private def fireAutoRun(pipelineId: PipelineId): Future[Unit] =
    pipelineRepo.findByIdInternal(pipelineId).flatMap {
      case None =>
        // The debounce row's own FK (V110, ON DELETE CASCADE) means this should be unreachable in
        // practice -- defensive against any future change to that constraint, mirrors `fire`'s own
        // "pipeline deleted after the schedule was created" defensive branch.
        log.warn("Auto-run claim for pipeline {} — pipeline not found, skipping fire", pipelineId.value)
        Future.successful(())
      case Some(pipeline) =>
        // HEL-1108 scheduled-run precedent, mirrored exactly: the pipeline owner is the acting
        // principal, source=System (not a browser-attributed Ui action).
        val owner = AuthenticatedUser(pipeline.ownerId, source = AuditSource.System, tokenId = None)
        pipelineRunService
          .submit(pipelineId, isDry = false, owner, triggerSource = TriggerSource.AutoRun)
          .transform {
            case Success(Left(err: ServiceError.TooManyRequests)) =>
              // Guard-rejected: recorded (logged), never silently dropped -- ticket AC #3/spec
              // scenario "An auto-run is rejected by the per-user rate limit". No exception
              // escapes -- the tick itself must never crash on this.
              log.info("Auto-run for pipeline {} rejected by the pipeline-run guard: {}", pipelineId.value, err.reason)
              Success(())
            case Success(_) => Success(())
            case Failure(ex) =>
              log.error(s"PipelineSchedulerService: auto-run submit raised unexpectedly for pipeline ${pipelineId.value}", ex)
              Success(())
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
        // HEL-483 design.md Decision 6: explicit source=System (not the
        // AuthenticatedUser default of Ui) — this is a cron-fired run, not a
        // browser-attributed action.
        val owner = AuthenticatedUser(pipeline.ownerId, source = AuditSource.System, tokenId = None)
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
