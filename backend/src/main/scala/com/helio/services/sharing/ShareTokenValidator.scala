package com.helio.services.sharing

import com.helio.domain.model.DashboardId
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Single validation predicate for the share-token fallback authorization path (design.md D4).
 *  Every failure mode -- unknown hash, revoked, expired, bound to a different resource -- returns
 *  `false` from the SAME call, with no distinct exception or error type, so the directive that
 *  consumes this has exactly one way to react to "no" regardless of why. This is what makes the
 *  indistinguishability property (expired/revoked/nonexistent/wrong-resource must look identical
 *  to the caller) structural rather than a matter of three call sites happening to agree today. */
trait ShareTokenValidator {

  /** `resourceType` is accepted for forward compatibility with a future non-dashboard resource
   *  kind (out of scope today -- HEL-593 stays dashboard-only) but is validated against: a token
   *  minted for one resource type/id never authorizes a different one. */
  def authorizes(resourceType: String, resourceId: String, token: String): Future[Boolean]
}

/** `repoOpt` is `None` when no [[com.helio.infrastructure.persistence.DbContext]] was supplied to
 *  `ApiRoutes` (test fixtures) -- mirrors this codebase's existing nullable-optional wiring
 *  convention; a fixture with no DbContext simply never authorizes via token, exactly as it
 *  never authorizes via the pre-existing public-viewer-grant path in that situation either. */
final class ShareTokenValidatorImpl(repoOpt: Option[ShareTokenRepository])(implicit ec: ExecutionContext)
    extends ShareTokenValidator {

  private val DashboardResourceType = "dashboard"

  override def authorizes(resourceType: String, resourceId: String, token: String): Future[Boolean] =
    if (resourceType != DashboardResourceType) {
      Future.successful(false)
    } else {
      repoOpt match {
        case None => Future.successful(false)
        case Some(repo) =>
          val hash = TokenHashing.sha256Hex(token)
          // One indexed lookup covers every failure mode -- unknown hash, revoked, expired, and
          // wrong-resource are all decided in memory afterwards from the SAME row fetch, so no
          // failure path costs an extra query (design.md's cost-parity note / task 2.5).
          repo.findActiveByHash(hash).map {
            case None => false
            case Some(shareToken) =>
              shareToken.dashboardId == DashboardId(resourceId) && shareToken.isActive(Instant.now())
          }
      }
    }
}
