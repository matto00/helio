package com.helio.services

import com.helio.api.protocols.HookTriggerResponse
import com.helio.domain.{AuthenticatedUser, PipelineId, TokenScope}
import com.helio.infrastructure.{PipelineRepository, PipelineRunRepository}

import scala.concurrent.{ExecutionContext, Future}

/** Service backing `POST /api/hooks/run` (HEL-369, design.md Decision 4).
 *  Deliberately thin: the actual run-lifecycle logic (pipeline ACL, source
 *  dispatch, engine execution, run-record persistence) lives entirely in
 *  [[PipelineRunService.submit]] -- the same path `POST /api/pipelines/:id/run`
 *  and the HEL-415 scheduler use. This class owns only the two things
 *  specific to the external-trigger surface:
 *
 *   1. A scoped token's pipeline allow-list check (403 outside scope).
 *   2. Collapsing a duplicate trigger into an already-in-flight run
 *      (design.md Decision 6) instead of opening a second run-invocation
 *      path or a general idempotency-key mechanism. */
final class HookTriggerService(
    pipelineRunService: PipelineRunService,
    pipelineRunRepo: PipelineRunRepository,
    pipelineRepo: PipelineRepository
)(implicit ec: ExecutionContext) {

  def trigger(
      pipelineId: PipelineId,
      user: AuthenticatedUser,
      tokenScope: Option[TokenScope]
  ): Future[Either[ServiceError, HookTriggerResponse]] =
    if (tokenScope.exists(!_.allowedPipelineIds.contains(pipelineId.value)))
      Future.successful(Left(ServiceError.Forbidden("Token is not scoped to this pipeline")))
    else
      // Sharing-aware existence check (owner or any grantee) BEFORE the
      // in-flight-run lookup below. `findActiveRunInternal`/`hasActiveRunInternal`
      // are ACL-bypassing (mirroring the HEL-415 scheduler's overlap guard,
      // which has no request-bound user) -- without this gate, a caller
      // holding any valid but unrelated, unscoped PAT could name an
      // arbitrary cross-user `pipelineId` and learn whether it has a run in
      // flight, an existence leak the codebase's ACL triad (CONTRIBUTING.md
      // "existence-not-leaked semantics") otherwise forbids for every other
      // per-id read. `submit` below re-verifies the stricter owner/editor
      // requirement itself regardless -- defense in depth, mirroring this
      // ticket's own scope double-check (design.md Risks/Trade-offs).
      pipelineRunService.pipelineExistsShared(pipelineId, user).flatMap {
        case false =>
          Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
        case true =>
          pipelineRunRepo.hasActiveRunInternal(pipelineId).flatMap {
            case true  => collapseIntoActiveRun(pipelineId)
            case false => submitNewRun(pipelineId, user, tokenScope)
          }
      }

  private def collapseIntoActiveRun(pipelineId: PipelineId): Future[Either[ServiceError, HookTriggerResponse]] =
    pipelineRunRepo.findActiveRunInternal(pipelineId).map {
      case Some(row) => Right(HookTriggerResponse(row.id, row.pipelineId, row.status))
      // Vanishingly unlikely (the run completed between the exists-check and
      // this read) -- treat it as "no run in flight after all" rather than
      // erroring the caller for a race this endpoint is explicitly meant to
      // absorb; a fresh submit is the correct fallback.
      case None => Left(ServiceError.Conflict("Active run resolved but could not be re-read; retry"))
    }

  private def submitNewRun(
      pipelineId: PipelineId,
      user: AuthenticatedUser,
      tokenScope: Option[TokenScope]
  ): Future[Either[ServiceError, HookTriggerResponse]] =
    pipelineRunService
      .submit(
        pipelineId,
        isDry = false,
        user,
        triggerSource = TriggerSource.External,
        triggeredByTokenId = tokenScope.map(_.tokenId.value)
      )
      .map(_.map { result =>
        // executeRun's only success (Right) branch always corresponds to a
        // completed run -- a failed run returns Left instead (see
        // PipelineRunService.executeRun's Failure branch) -- but a `Right`
        // result can still be blocked by the assert fail-policy (HEL-570,
        // design.md Decision 8a): `result.blocked` distinguishes that case.
        // No rollback here -- a hook-triggered run always re-runs an
        // existing pipeline, so the prior DataType snapshot is already
        // correct regardless of this run's outcome.
        val status = if (result.blocked) "failed" else "succeeded"
        HookTriggerResponse(result.runId.getOrElse(pipelineId.value), pipelineId.value, status)
      })
}
