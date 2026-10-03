package com.helio.services.auth

import com.helio.services.ServiceError
import com.helio.domain.model.{AuthenticatedUser, ResourceAccess}

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
 *    `ResourceAccess.Owner` on success; `NotFound(notFoundMessage)` if the resource
 *    doesn't exist OR the caller has no grant on it (the two are indistinguishable,
 *    HEL-1002); `Forbidden` only for a grantee, who already sees the resource.
 *  - `requireAccess`    — any tier of access (owner / editor / viewer). Public-viewer
 *    grants let an unauthenticated request through with `Viewer`; a missing resource,
 *    or one the caller has no grant on, returns the same `NotFound(notFoundMessage)`
 *    so existence is never leaked.
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
