package com.helio.services.sharing

import com.helio.api.protocols.sharing.{CreateShareTokenRequest, CreateShareTokenResponse}
import com.helio.domain.model.{AuthenticatedUser, DashboardId, ResourceAccess, ShareToken, ShareTokenId, UserId}
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker

import java.security.SecureRandom
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.{Base64, UUID}
import scala.concurrent.{ExecutionContext, Future}

/** Create/list/revoke for dashboard share tokens (HEL-590). Every operation is gated by
 *  `accessChecker.requireOwnerOnly` first, matching the `PermissionService` template exactly --
 *  only the dashboard's owner may mint, list, or revoke its share tokens.
 *
 *  Evaluation-1.md CR7 / Adjudication: `requireOwnerOnly` itself returns `Forbidden` for a
 *  real-but-unowned dashboard and `NotFound` for an absent one -- a pre-existing, cross-cutting
 *  leak shared by every owner-only resource in this codebase (`AccessChecker`), out of scope to
 *  fix here. But `ShareTokenService` is brand-new surface with no back-compat obligation, and the
 *  ticket's own theme ("no resource leak and no existence oracle") is incoherent if the anonymous
 *  read path goes to structural lengths to be non-distinguishing while the management path on the
 *  SAME resource answers the same question with a 403. `mapForbiddenToNotFound` closes that gap
 *  locally, in the three call sites below, without touching the shared `AccessChecker` (a separate
 *  spinoff tracks the cross-cutting fix for every other owner-only route). */
final class ShareTokenService(
    shareTokenRepo: ShareTokenRepository,
    accessChecker:  AccessChecker
)(implicit ec: ExecutionContext) {

  import ShareTokenService._

  private val ResourceType = "dashboard"

  /** `requireOwnerOnly`'s `Forbidden` (real-but-unowned) collapses onto its own `NotFound`
   *  (absent) message so the two are indistinguishable to a non-owner caller -- see the class doc
   *  above. Every other `ServiceError` variant passes through unchanged. */
  private def mapForbiddenToNotFound(result: Either[ServiceError, ResourceAccess]): Either[ServiceError, ResourceAccess] =
    result match {
      case Left(ServiceError.Forbidden(_)) => Left(ServiceError.NotFound("Dashboard not found"))
      case other                           => other
    }

  private def requireOwner(dashboardId: String, user: AuthenticatedUser): Future[Either[ServiceError, ResourceAccess]] =
    accessChecker.requireOwnerOnly(ResourceType, dashboardId, user, "Dashboard not found").map(mapForbiddenToNotFound)

  def create(
      dashboardId: String,
      request: CreateShareTokenRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, CreateShareTokenResponse]] =
    requireOwner(dashboardId, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        parseExpiresAt(request.expiresAt) match {
          case Left(err) => Future.successful(Left(err))
          case Right(expiresAt) =>
            val rawToken = generateRawToken()
            val now      = Instant.now()
            val token = ShareToken(
              id          = ShareTokenId(UUID.randomUUID().toString),
              dashboardId = DashboardId(dashboardId),
              userId      = user.id,
              tokenHash   = TokenHashing.sha256Hex(rawToken),
              expiresAt   = expiresAt,
              revokedAt   = None,
              createdAt   = now
            )
            shareTokenRepo.insert(token).map { created =>
              Right(
                CreateShareTokenResponse(
                  id          = created.id.value,
                  dashboardId = created.dashboardId.value,
                  token       = rawToken,
                  expiresAt   = created.expiresAt.map(_.toString),
                  createdAt   = created.createdAt.toString
                )
              )
            }
        }
    }

  def list(dashboardId: String, user: AuthenticatedUser): Future[Either[ServiceError, Vector[ShareToken]]] =
    requireOwner(dashboardId, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  => shareTokenRepo.findByDashboard(DashboardId(dashboardId), user.id).map(Right(_))
    }

  /** Idempotent: revoking an already-revoked token succeeds without changing the outcome.
   *  A token id that doesn't exist under this dashboard -- whether it never existed or belongs to
   *  another owner -- maps to the same `NotFound`, matching `PermissionService.revoke`'s existing
   *  non-leak convention (RLS via `withUserContext` makes those two cases indistinguishable at the
   *  repository layer already). */
  def revoke(dashboardId: String, tokenId: ShareTokenId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    requireOwner(dashboardId, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        shareTokenRepo.revoke(tokenId, user.id).map {
          case true  => Right(())
          case false => Left(ServiceError.NotFound("Share token not found"))
        }
    }

  private def parseExpiresAt(raw: Option[String]): Either[ServiceError, Option[Instant]] =
    raw match {
      case None => Right(None)
      case Some(str) =>
        try {
          val parsed = Instant.parse(str)
          if (!parsed.isAfter(Instant.now()))
            Left(ServiceError.BadRequest("expiresAt must be in the future"))
          else
            Right(Some(parsed))
        } catch {
          case _: DateTimeParseException =>
            Left(ServiceError.BadRequest("expiresAt must be an ISO-8601 instant"))
        }
    }
}

object ShareTokenService {
  private val rng = new SecureRandom()

  /** CSPRNG, 32 bytes (256 bits), base64url unpadded (design.md D3) -- never a general-purpose
   *  pseudo-random generator, never a UUID, never derived from the dashboard id or a timestamp. */
  def generateRawToken(): String = {
    val bytes = new Array[Byte](32)
    rng.nextBytes(bytes)
    Base64.getUrlEncoder.withoutPadding().encodeToString(bytes)
  }
}
