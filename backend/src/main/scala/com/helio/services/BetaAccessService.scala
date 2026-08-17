package com.helio.services

import com.helio.domain.{AuthenticatedUser, User, UserId, UserTier}
import com.helio.email.EmailSender
import com.helio.infrastructure.{InviteCodeRepository, TokenHashing, UserRepository}

import java.time.{Duration, Instant}
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContext, Future}

/** Orchestrates HEL-704's two beta-access flows (design.md D4/D5): request-access (email the
 *  owner) and redeem (consume a code, upgrade tier). Both start with the same
 *  `userRepo.findById` tier resolution -- `AuthenticatedUser` alone carries only an id, not tier
 *  (mirrors `ChatAccessService`'s own per-request `findById` reasoning: not folded into
 *  `AuthDirectives`/`AuthenticatedUser` for one feature's need).
 *
 *  `emailSenderOpt` is `None` when `EmailConfig.fromEnv()` failed (design.md D6) -- request-
 *  access degrades to [[BetaAccessError.EmailUnconfigured]]; redeem never touches email at all. */
final class BetaAccessService(
    inviteCodeRepo: InviteCodeRepository,
    userRepo: UserRepository,
    tierConfig: UserTierConfig,
    emailSenderOpt: Option[EmailSender]
)(implicit ec: ExecutionContext) {
  import BetaAccessService._

  /** Best-effort, in-memory, per-process cooldown (design.md D4) -- deliberately NOT persisted;
   *  a restart resets it, and the worst case is one duplicate email landing in a human inbox, not
   *  a security boundary. `ConcurrentHashMap` needs no external lock under Pekko HTTP's
   *  multi-threaded request dispatch. */
  private val lastRequestAt = new ConcurrentHashMap[String, Instant]()

  /** `POST /api/beta-access/request` (beta-access-request spec). Ordering: tier eligibility
   *  (409) -> email-capability-usable (503, D4) -> cooldown (429, D4) -> provider send (502 on
   *  failure). Only a provider-accepted send records the cooldown timestamp -- a failed send
   *  never consumes it, so the caller may retry immediately. */
  def requestAccess(user: AuthenticatedUser): Future[Either[BetaAccessError, Unit]] =
    userRepo.findById(user.id).flatMap {
      case Some(u) if u.tier != UserTier.Free =>
        Future.successful(Left(BetaAccessError.NotEligible(AlreadyGrantedRequestMessage)))
      case Some(u) =>
        val recipients = tierConfig.ownerEmails.toSeq
        emailSenderOpt match {
          case None =>
            Future.successful(Left(BetaAccessError.EmailUnconfigured()))
          case Some(_) if recipients.isEmpty =>
            Future.successful(Left(BetaAccessError.EmailUnconfigured()))
          case Some(_) if withinCooldown(u.id) =>
            Future.successful(Left(BetaAccessError.Cooldown()))
          case Some(sender) =>
            sender.send(recipients, RequestSubject, requestBody(u)).map {
              case Right(()) =>
                lastRequestAt.put(u.id.value, Instant.now())
                Right(())
              case Left(_) =>
                Left(BetaAccessError.SendFailed())
            }
        }
      case None =>
        Future.successful(Left(BetaAccessError.NotEligible(AlreadyGrantedRequestMessage)))
    }

  /** `POST /api/beta-access/redeem` (invite-code-redemption spec). Pre-checks the caller's tier
   *  is `free` (409 otherwise, before any code is touched -- design.md D3) then hands the
   *  sha256-hashed code to `InviteCodeRepository.redeemAndUpgrade`'s atomic consume-and-upgrade.
   *  Re-fetches the user on success so the returned `User` always reflects the just-committed
   *  tier, rather than trusting an optimistic `.copy(tier = Beta)`. */
  def redeem(user: AuthenticatedUser, code: String): Future[Either[BetaAccessError, User]] =
    userRepo.findById(user.id).flatMap {
      case Some(u) if u.tier != UserTier.Free =>
        Future.successful(Left(BetaAccessError.NotEligible(AlreadyGrantedRedeemMessage)))
      case Some(u) =>
        val codeHash = TokenHashing.sha256Hex(code)
        inviteCodeRepo.redeemAndUpgrade(u.id, codeHash).flatMap {
          case true =>
            userRepo.findById(u.id).map {
              case Some(upgraded) => Right(upgraded)
              case None           => Left(BetaAccessError.InvalidCode())
            }
          case false =>
            Future.successful(Left(BetaAccessError.InvalidCode()))
        }
      case None =>
        Future.successful(Left(BetaAccessError.NotEligible(AlreadyGrantedRedeemMessage)))
    }

  private def withinCooldown(userId: UserId): Boolean =
    Option(lastRequestAt.get(userId.value)).exists(_.isAfter(Instant.now().minus(CooldownWindow)))

  private def requestBody(user: User): String =
    s"""A free-tier user has requested Beta access to Helio.
       |
       |Email: ${user.email}
       |Display name: ${user.displayName.getOrElse("(none)")}
       |User id: ${user.id.value}
       |Account created: ${user.createdAt}
       |""".stripMargin
}

object BetaAccessService {
  private val RequestSubject = "Helio Beta access request"

  private val AlreadyGrantedRequestMessage: String =
    "Beta access has already been granted; no request is needed."
  private val AlreadyGrantedRedeemMessage: String =
    "Beta access has already been granted; code redemption is not needed."

  private val CooldownWindow: Duration = Duration.ofHours(1)
}
