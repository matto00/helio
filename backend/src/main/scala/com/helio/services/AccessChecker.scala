package com.helio.services

import com.helio.domain.{AuthenticatedUser, ResourceAccess}

import scala.concurrent.Future

/** ACL surface used by services. Mirrors the resource-level authorization that
 *  the HTTP `AclDirective` performs, but returns a typed `Either[ServiceError, A]`
 *  instead of completing a Pekko `Route`.
 *
 *  Services use this directly so resource-level ACL checks live with the
 *  business logic. The HTTP layer's `AclDirective` continues to handle
 *  authentication-level concerns (is this request authenticated at all?) and
 *  remains the entry point for routes that haven't yet been folded into the
 *  service layer.
 *
 *  Methods:
 *  - `requireOwnerOnly` — only the owner of the resource is permitted. Returns
 *    `ResourceAccess.Owner` on success, `NotFound` if the resource doesn't exist
 *    or no user is provided for a private resource, `Forbidden` otherwise.
 *  - `requireAccess`    — any tier of access (owner / editor / viewer). Mirrors
 *    `AclDirective.authorizeResourceWithSharing` exactly: public-viewer grants
 *    let an unauthenticated request through with `Viewer`, missing/private
 *    resources return `NotFound` to avoid leaking existence.
 */
trait AccessChecker {

  def requireOwnerOnly(
      resourceType: String,
      resourceId: String,
      user: AuthenticatedUser,
      notFoundMessage: String = "Not found"
  ): Future[Either[ServiceError, ResourceAccess]]

  def requireAccess(
      resourceType: String,
      resourceId: String,
      userOpt: Option[AuthenticatedUser],
      notFoundMessage: String = "Not found"
  ): Future[Either[ServiceError, ResourceAccess]]
}
