package com.helio.services.auth

import com.helio.domain.model.{AuthenticatedUser, UserTier}
import com.helio.infrastructure.persistence.assistant.AssistantDailyUsageRepository
import com.helio.infrastructure.persistence.auth.UserRepository

import scala.concurrent.{ExecutionContext, Future}

/** Tier enforcement for `/api/assistant-conversations` (HEL-703, design.md D3/D5/D6). Tier is
 *  resolved per-request from a plain `userRepo.findById` lookup -- deliberately NOT folded into
 *  `AuthDirectives`/`AuthenticatedUser` (design.md D3): one indexed PK lookup per assistant call is
 *  noise next to a Claude round-trip, and widening the shared authenticated-identity type for one
 *  feature's need was rejected.
 *
 *  Two entry points mirror the two places `AssistantConversationRoutes` needs a verdict:
 *
 *  - [[guard]] wraps EVERY endpoint in the family (list/create/get/messages/patch/converse) --
 *    denies `free` with [[ChatAccessError.TierForbidden]], and otherwise returns the resolved
 *    [[UserTier]] so the route layer can decide whether `converse` also needs [[checkConverseCap]].
 *  - [[checkConverseCap]] runs ADDITIONALLY, only on the converse endpoint, only for `beta` --
 *    `owner` is always uncounted, and `free` is unreachable here (already denied by [[guard]]). */
final class ChatAccessService(
    userRepo: UserRepository,
    usageRepo: AssistantDailyUsageRepository,
    config: UserTierConfig
)(implicit ec: ExecutionContext) {

  /** `Left` for `free` (or an unresolvable user id -- shouldn't happen post-`authenticate`, but
   *  fails closed rather than throwing); `Right(tier)` for `beta`/`owner`. */
  def guard(user: AuthenticatedUser): Future[Either[ChatAccessError, UserTier]] =
    userRepo.findById(user.id).map {
      case Some(u) if u.tier != UserTier.Free => Right(u.tier)
      case _                                   => Left(ChatAccessError.TierForbidden())
    }

  /** `tier` is the value [[guard]] already resolved for this same request -- avoids a second
   *  `findById` round trip. `owner` always succeeds uncounted; `beta` atomically increments (or
   *  denies) via `AssistantDailyUsageRepository.incrementIfUnderCap`; `free` is unreachable in
   *  practice (guard already denied it) but still resolves safely rather than assuming. */
  def checkConverseCap(user: AuthenticatedUser, tier: UserTier): Future[Either[ChatAccessError, Unit]] =
    tier match {
      case UserTier.Owner => Future.successful(Right(()))
      case UserTier.Beta =>
        usageRepo.incrementIfUnderCap(user.id, config.betaDailyMessageLimit).map {
          case true  => Right(())
          case false => Left(ChatAccessError.LimitReached(config.betaDailyMessageLimit))
        }
      case UserTier.Free => Future.successful(Left(ChatAccessError.TierForbidden()))
    }
}
