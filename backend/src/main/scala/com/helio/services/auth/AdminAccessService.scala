package com.helio.services.auth

import com.helio.domain.model.{AuthenticatedUser, UserTier}
import com.helio.infrastructure.persistence.auth.UserRepository

import scala.concurrent.{ExecutionContext, Future}

/** Owner-only gate for the admin routes (HEL-1211). Resolves the tier per request from a plain
 *  `userRepo.findById` -- the stored tier, never anything client-supplied -- and fails closed:
 *  anything other than a found `owner` (free, beta, or an unresolvable id) is denied with the
 *  existing [[ChatAccessError.TierForbidden]] so the wire shape is the shared `TIER_FORBIDDEN` 403. */
final class AdminAccessService(userRepo: UserRepository)(implicit ec: ExecutionContext) {

  def guardOwner(user: AuthenticatedUser): Future[Either[ChatAccessError, Unit]] =
    userRepo.findById(user.id).map {
      case Some(u) if u.tier == UserTier.Owner => Right(())
      case _                                   => Left(ChatAccessError.TierForbidden(AdminAccessService.ForbiddenMessage))
    }
}

object AdminAccessService {
  val ForbiddenMessage: String = "Owner access required"
}
