package com.helio.services.auth

import com.helio.domain.model.{UserId, UserTier}
import com.helio.infrastructure.persistence.assistant.AssistantDailyUsageRepository
import com.helio.infrastructure.persistence.auth.UserRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1108 (design.md D3/D6/D7/D8): the tier gate `ClaudeAiStepClient.complete` enforces BEFORE
 *  every pipeline AI model call, keyed on the pipeline OWNER's id (never the triggering caller's,
 *  per HEL-1100 D5). A trait (rather than a concrete class) so `ClaudeAiStepClient`'s own tests
 *  (which exercise real guardrail/error-mapping behavior through a fake TRANSPORT, tasks.md C4)
 *  can inject a trivial always-permit/always-deny fake here too, with no `UserRepository`/DB in
 *  scope. [[AiPipelineQuotaGate.Live]] is the production implementation, wired in `ApiRoutes`. */
trait AiPipelineQuotaGate {

  /** `Right(())` permits the call; `Left(limit)` denies it, carrying the configured limit for the
   *  caller's `QuotaExceeded` message. */
  def checkAndIncrement(ownerUserId: UserId): Future[Either[Int, Unit]]
}

object AiPipelineQuotaGate {

  /** Reuses `ChatAccessService`'s underlying machinery -- `UserRepository`,
   *  `AssistantDailyUsageRepository`, `UserTierConfig` -- rather than reimplementing tier lookup
   *  or the atomic daily counter, and shares the SAME `assistant_daily_usage` row/limit chat uses
   *  (D3): a beta user has ONE daily AI budget, not two.
   *
   *  Deliberately built from `userRepo`/`dbContext` directly in `ApiRoutes` rather than
   *  referencing `ApiRoutes.chatAccessServiceOpt` (design-gate N6): that val is declared AFTER
   *  `aiStepClient` in `ApiRoutes`'s declaration order, so a reference to it there would silently
   *  capture `null` with no compiler complaint. */
  final class Live(
      userRepo: UserRepository,
      usageRepo: AssistantDailyUsageRepository,
      config: UserTierConfig
  )(implicit ec: ExecutionContext) extends AiPipelineQuotaGate {

    /** `owner` is never counted (D7); `beta` atomically increments or denies via
     *  `incrementIfUnderCap`; `free` and an unresolvable owner id are both denied, matching D8's
     *  "not permitted, never exempt" rule for anything short of a confirmed non-`free` tier. */
    override def checkAndIncrement(ownerUserId: UserId): Future[Either[Int, Unit]] =
      userRepo.findById(ownerUserId).flatMap {
        case Some(u) if u.tier == UserTier.Owner =>
          Future.successful(Right(()))
        case Some(u) if u.tier == UserTier.Beta =>
          // HEL-1108 (design.md Risks): `incrementIfUnderCap` runs its statement under
          // `ctx.withUserContext(ownerUserId)` (inside AssistantDailyUsageRepository) -- setting
          // the DB user context to the pipeline OWNER rather than the request's triggering caller
          // is intentional. It's what satisfies V88's `user_id = current_setting(...)` RLS policy
          // on the app pool, with no bypass, for a grantee-triggered or scheduler-fired run.
          usageRepo.incrementIfUnderCap(ownerUserId, config.betaDailyMessageLimit).map {
            case true  => Right(())
            case false => Left(config.betaDailyMessageLimit)
          }
        case _ =>
          // `free` tier, or no user row for this id at all (shouldn't happen for a persisted
          // pipeline's owner, but fails closed rather than throwing).
          Future.successful(Left(config.betaDailyMessageLimit))
      }
  }
}
