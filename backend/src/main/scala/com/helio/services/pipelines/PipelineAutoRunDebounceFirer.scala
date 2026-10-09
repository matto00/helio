package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.domain.model.{AuditSource, AuthenticatedUser, PipelineId}
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRunRepository}
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

  private val log = LoggerFactory.getLogger(classOf[PipelineSchedulerService])

  /** HEL-1093 (design.md Decision 3): claims every due `pipeline_auto_run_debounce` row and fires
   *  each one through the existing `PipelineRunService.submit` path, as the pipeline owner —
   *  mirrors `PipelineSchedulerService.fire`'s synthetic-owner-identity pattern exactly. */
  def processAutoRunDebounce(now: Instant): Future[Unit] =
    autoRunDebounceRepo.claimDue(now, staleClaimAfter = now.minusSeconds(staleClaimAfterSeconds)).flatMap { claimed =>
      Future.traverse(claimed) { case (pipelineId, claimedAt) =>
        processAutoRunClaim(pipelineId, claimedAt).recover { case ex =>
          log.error(s"PipelineSchedulerService: unexpected failure processing auto-run claim for pipeline ${pipelineId.value}", ex)
          ()
        }
      }.map(_ => ())
    }

  /** Fires (unless a same-pipeline run is already active — the same narrower overlap
   *  consideration `PipelineSchedulerService.fireIfNotOverlapping` already applies to scheduled fires, design.md Decision
   *  3 step 2) then ALWAYS releases the claim (step 4), whether fired, skipped, or guard-rejected
   *  — see `PipelineAutoRunDebounceRepository.releaseClaim`'s own doc for why an unconditional
   *  release would be wrong. */
  private def processAutoRunClaim(pipelineId: PipelineId, claimedAt: Instant): Future[Unit] =
    runRepo.hasActiveRunInternal(pipelineId).flatMap {
      case true =>
        log.debug("Skipping auto-run claim for pipeline {} — already has an active run", pipelineId.value)
        autoRunDebounceRepo.releaseClaim(pipelineId, claimedAt)
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
            Future.successful(())
          case Failure(ex) =>
            log.error(s"PipelineSchedulerService: auto-run fire-time evaluation failed for pipeline ${pipelineId.value}; not submitting", ex)
            Future.successful(())
        }.flatMap { _ => autoRunDebounceRepo.releaseClaim(pipelineId, claimedAt) }
    }

  private def fireAutoRun(pipelineId: PipelineId): Future[Unit] =
    pipelineRepo.findByIdInternal(pipelineId).flatMap {
      case None =>
        // The debounce row's own FK (V110, ON DELETE CASCADE) means this should be unreachable in
        // practice -- defensive against any future change to that constraint, mirrors `PipelineSchedulerService.fire`'s own
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
}
