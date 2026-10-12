package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.domain.model.{AuditSource, AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRunRepository, RearmOutcome}
import org.slf4j.LoggerFactory

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** The dataset-write auto-run debounce claim-and-fire pass (HEL-1093), split out of
 *  [[PipelineSchedulerService]] (HEL-1429). [[PipelineSchedulerService.tick]] calls
 *  [[processAutoRunDebounce]] once per tick, wrapped in the tick's own `.recover`; it builds this
 *  collaborator only when `autoRunDebounceRepo` is wired, so an unwired fixture skips the pass.
 *
 *  Logs under the scheduler's logger name (not this class's) so every message and any appender
 *  attached to `PipelineSchedulerService` is unchanged by the split. */
private[pipelines] final class PipelineAutoRunDebounceFirer(
    autoRunDebounceRepo: PipelineAutoRunDebounceRepository,
    staleClaimAfterSeconds: Long,
    runRepo: PipelineRunRepository,
    pipelineRepo: PipelineRepository,
    pipelineRunService: PipelineRunService,
    autoRunTriggerService: AutoRunTriggerService
)(implicit ec: ExecutionContext) {

  /** The guard config `pipelineRunService` itself enforces -- the single source of the cap, the
   *  advisory Retry-After, and (HEL-1504) the re-arm allowance, so they cannot drift apart. */
  private def guardConfig: PipelineRunGuardConfig = pipelineRunService.guardConfig

  private val log = LoggerFactory.getLogger(classOf[PipelineSchedulerService])

  /** HEL-1093 (design.md Decision 3): claims every due `pipeline_auto_run_debounce` row and fires
   *  each one through the existing `PipelineRunService.submit` path, as the pipeline owner —
   *  mirrors `PipelineSchedulerService.fire`'s synthetic-owner-identity pattern exactly. */
  def processAutoRunDebounce(now: Instant): Future[Unit] =
    autoRunDebounceRepo.claimDue(now, staleClaimAfter = now.minusSeconds(staleClaimAfterSeconds)).flatMap { claimed =>
      Future.traverse(claimed) { case (pipelineId, claimedAt) =>
        processAutoRunClaim(pipelineId, claimedAt, now).recover { case ex =>
          log.error(s"PipelineSchedulerService: unexpected failure processing auto-run claim for pipeline ${pipelineId.value}", ex)
          ()
        }
      }.map(_ => ())
    }

  /** HEL-1504: what happens to the claim after one fire attempt.
   *  - an active run on the pipeline: the claim is handed back un-deleted ([[PipelineAutoRunDebounceRepository.unclaim]]),
   *    so the write stays pending and fires once that run completes (same-pipeline overlap, as
   *    `PipelineSchedulerService.fireIfNotOverlapping` applies to scheduled fires);
   *  - a guard rejection (or the owner being at the concurrency cap): the row is re-armed after the
   *    Retry-After, at most `autoRunMaxRetries` times, then dropped with a WARN;
   *  - everything else (fired, fire-time verdict denial, pipeline gone, unexpected failure): the claim
   *    is released (compare-and-delete), exactly as before -- see `releaseClaim`'s own doc. */
  private def processAutoRunClaim(pipelineId: PipelineId, claimedAt: Instant, now: Instant): Future[Unit] =
    runRepo.hasActiveRunInternal(pipelineId).flatMap {
      case true =>
        log.debug("Auto-run claim for pipeline {} — already has an active run, keeping it pending", pipelineId.value)
        autoRunDebounceRepo.unclaim(pipelineId, claimedAt)
      case false =>
        // HEL-1384 (design.md D2/D5): re-evaluate the write-time verdict NOW. A denial (or an
        // evaluation failure -- never a fail-open submit) skips the fire; the claim is released
        // either way, so a denied pipeline's pending row cannot fire and cannot retry-storm.
        autoRunTriggerService.evaluateAtFire(pipelineId).transformWith {
          case Success(reasons) if reasons.isEmpty => fireAutoRun(pipelineId)
          case Success(reasons) =>
            log.info(
              "PipelineSchedulerService: auto-run for pipeline {} denied at fire time, skipping: {}",
              pipelineId.value, reasons.map(r => s"${r.code}: ${r.detail}").mkString("; ")
            )
            Future.successful(FireOutcome.Done)
          case Failure(ex) =>
            log.error(s"PipelineSchedulerService: auto-run fire-time evaluation failed for pipeline ${pipelineId.value}; not submitting", ex)
            Future.successful(FireOutcome.Done)
        }.flatMap {
          case FireOutcome.Done => autoRunDebounceRepo.releaseClaim(pipelineId, claimedAt)
          case FireOutcome.GuardRejected(ownerId, retryAfterSeconds, reason) =>
            // The 1 s floor guarantees a `Retry-After` of 0 can never re-claim on the same tick.
            val fireAt = now.plusSeconds(math.max(1L, retryAfterSeconds))
            autoRunDebounceRepo.rearmAfterGuardRejection(pipelineId, claimedAt, fireAt, guardConfig.autoRunMaxRetries).map {
              case RearmOutcome.Rearmed(attempt) =>
                log.info("Auto-run for pipeline {} rejected by the pipeline-run guard ({}); re-armed for {} (attempt {} of {})",
                  pipelineId.value, reason, fireAt, attempt, guardConfig.autoRunMaxRetries)
              case RearmOutcome.Exhausted(attempts) =>
                log.warn("Dropping pending auto-run for pipeline {} (owner {}): rejected by the pipeline-run guard ({}) after {} re-attempts",
                  pipelineId.value, ownerId.value, reason, attempts)
              case RearmOutcome.Superseded =>
                log.debug("Auto-run for pipeline {}: claim token no longer matches (a fresh write re-armed the row, or another instance took over a stale claim)", pipelineId.value)
            }
        }
    }

  private def fireAutoRun(pipelineId: PipelineId): Future[FireOutcome] =
    pipelineRepo.findByIdInternal(pipelineId).flatMap {
      case None =>
        // The debounce row's own FK (V110, ON DELETE CASCADE) means this should be unreachable in
        // practice -- defensive against any future change to that constraint, mirrors `PipelineSchedulerService.fire`'s own
        // "pipeline deleted after the schedule was created" defensive branch.
        log.warn("Auto-run claim for pipeline {} — pipeline not found, skipping fire", pipelineId.value)
        Future.successful(FireOutcome.Done)
      case Some(pipeline) =>
        // HEL-1504 (design.md D2a): a read-only pre-flight of the owner's concurrency cap. A
        // rejection INSIDE `submit` would first consume one of the owner's rate slots, so an
        // auto-run that would hit the cap is held back before `submit`. Strictly more conservative
        // than the guard and never an admission -- `submit` stays authoritative.
        runRepo.countOwnerInFlightRealRunsInternal(pipeline.ownerId).recover { case ex =>
          log.warn(s"Auto-run concurrency pre-flight failed for pipeline ${pipelineId.value}; deferring to submit", ex)
          0
        }.flatMap { inFlight =>
          if (inFlight >= guardConfig.maxConcurrent)
            Future.successful(FireOutcome.GuardRejected(pipeline.ownerId, guardConfig.concurrencyRetryAfterSeconds, "Pipeline-run concurrency limit exceeded"))
          else submitAutoRun(pipeline.ownerId, pipelineId)
        }
    }

  private def submitAutoRun(ownerId: UserId, pipelineId: PipelineId): Future[FireOutcome] = {
    // HEL-1108 scheduled-run precedent, mirrored exactly: the pipeline owner is the acting
    // principal, source=System (not a browser-attributed Ui action).
    val owner = AuthenticatedUser(ownerId, source = AuditSource.System, tokenId = None)
    pipelineRunService
      .submit(pipelineId, isDry = false, owner, triggerSource = TriggerSource.AutoRun)
      .transform {
        case Success(Left(err: ServiceError.TooManyRequests)) =>
          // Guard-rejected: never silently dropped -- the caller re-arms it (HEL-1504). No exception
          // escapes -- the tick itself must never crash on this.
          Success(FireOutcome.GuardRejected(ownerId, err.retryAfterSeconds, err.reason))
        case Success(_) => Success(FireOutcome.Done)
        case Failure(ex) =>
          log.error(s"PipelineSchedulerService: auto-run submit raised unexpectedly for pipeline ${pipelineId.value}", ex)
          Success(FireOutcome.Done)
      }
  }
}

private[pipelines] sealed trait FireOutcome
private[pipelines] object FireOutcome {
  /** Fired, skipped, or failed unexpectedly: the claim is released. */
  case object Done extends FireOutcome
  /** The guard (or the pre-flight cap check) rejected the fire: the row is re-armed or exhausted. */
  final case class GuardRejected(ownerId: UserId, retryAfterSeconds: Long, reason: String) extends FireOutcome
}
