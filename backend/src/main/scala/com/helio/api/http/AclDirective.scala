package com.helio.api.http

import com.helio.api.ErrorResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directive0, Directive1}
import org.apache.pekko.http.scaladsl.server.Directives._
import com.helio.api.protocols.ResourceProtocol
import com.helio.domain.model.{AuthenticatedUser, ResourceAccess, Role}
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.services.sharing.ShareTokenValidator

import scala.concurrent.{ExecutionContext, Future}

/** ACL directive that enforces resource ownership before executing the inner route.
 *
 *  Resolvers are looked up from the [[ResourceTypeRegistry]] by resource type key.
 *  Routes pass a `resourceType: String` — the directive resolves the owner and applies
 *  the appropriate access control logic.
 *
 *  - Unknown resource type key    → 500 Internal Server Error
 *  - Resource not found           → 404 Not Found
 *  - Resource found, wrong owner  → 403 Forbidden
 *  - Resource found, correct owner → inner route executes
 *
 *  Registering a new resource type only requires adding a [[ResourceType]] entry to the
 *  [[ResourceTypeRegistry]] in `ApiRoutes` — this directive itself is resource-type-agnostic.
 */
class AclDirective(
    permissionRepo: ResourcePermissionRepository,
    registry: ResourceTypeRegistry,
    // HEL-590 (evaluation-1.md CR8): consulted as a fallback whenever grant-based resolution in
    // `authorizeResourceWithSharing` denies (design.md D5). `Option`, not a `null` default --
    // this is a security-critical directive, and a forgotten argument should be visible in the
    // type system rather than silently degrading the token path to "never authorizes" with no
    // compile error or runtime signal. Trailing, defaulted constructor param so the two existing
    // call sites compile unchanged.
    shareTokenValidator: Option[ShareTokenValidator] = None
)(implicit ec: ExecutionContext) extends ResourceProtocol {

  def authorizeResource(
      resourceId: String,
      user: AuthenticatedUser,
      resourceType: String,
      notFoundMessage: String = "Not found"
  ): Directive0 =
    provide(registry.lookup(resourceType)).flatMap {
      case None =>
        complete(StatusCodes.InternalServerError, ErrorResponse(s"Unknown resource type: $resourceType"))
      case Some(rt) =>
        onComplete(rt.ownerResolver(resourceId)).flatMap {
          case scala.util.Success(None) =>
            complete(StatusCodes.NotFound, ErrorResponse(notFoundMessage))

          case scala.util.Success(Some(ownerId)) if ownerId != user.id.value =>
            complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))

          case scala.util.Success(Some(_)) =>
            pass

          case scala.util.Failure(_) =>
            complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
        }
    }

  /** ACL directive that enforces resource access with sharing permissions.
   *
   *  Looks up the owner resolver from the [[ResourceTypeRegistry]] using `resourceType`.
   *
   *  Logic:
   *  - Unknown resource type key → 500 Internal Server Error
   *  - Resource not found → 404 Not Found
   *  - User is owner → provide ResourceAccess.Owner
   *  - User has grant → provide ResourceAccess.Editor or ResourceAccess.Viewer based on role
   *  - No user but public viewer grant exists → provide ResourceAccess.Viewer
   *  - No user and no public grant → 404 Not Found (hide private resources from unauthenticated users)
   *  - User exists but no access → 403 Forbidden
   */
  def authorizeResourceWithSharing(
      resourceType: String,
      resourceId: String,
      userOpt: Option[AuthenticatedUser],
      notFoundMessage: String = "Not found",
      // HEL-590 (design.md D5): a share-link token, consulted only as a fallback when
      // grant-based resolution below DENIES -- both the authenticated-no-grant 403 arm and the
      // anonymous-no-public-grant 404 arm, never confined to just the anonymous branch (a
      // logged-in caller who happens to hold a valid share link must not 403). Never consulted
      // when grant-based resolution already granted Owner/Editor/Viewer -- a token never
      // downgrades or overrides an access level already resolved.
      shareToken: Option[String] = None
  ): Directive1[ResourceAccess] = {
    // HEL-590 (design.md D4): exactly one way to react to "the token didn't authorize" --
    // whichever denial the calling arm would have produced with no token at all. No new
    // complete(...) call, status, or message is introduced anywhere in this path.
    def tokenAuthorizes: Future[Boolean] =
      (shareTokenValidator, shareToken) match {
        case (Some(validator), Some(token)) => validator.authorizes(resourceType, resourceId, token)
        case _                              => Future.successful(false)
      }

    provide(registry.lookup(resourceType)).flatMap {
      case None =>
        complete(StatusCodes.InternalServerError, ErrorResponse(s"Unknown resource type: $resourceType"))
      case Some(rt) =>
        onComplete(rt.ownerResolver(resourceId)).flatMap {
          case scala.util.Success(None) =>
            complete(StatusCodes.NotFound, ErrorResponse(notFoundMessage))

          case scala.util.Success(Some(ownerId)) =>
            userOpt match {
              case Some(user) if user.id.value == ownerId =>
                provide(ResourceAccess.Owner)

              case Some(user) =>
                onComplete(permissionRepo.findGrant(resourceType, resourceId, user.id)).flatMap {
                  case scala.util.Success(Some(grant)) =>
                    grant.role match {
                      case Role.Editor => provide(ResourceAccess.Editor)
                      case Role.Viewer => provide(ResourceAccess.Viewer)
                    }
                  case scala.util.Success(None) =>
                    onComplete(tokenAuthorizes).flatMap {
                      case scala.util.Success(true) =>
                        provide(ResourceAccess.Viewer)
                      case scala.util.Success(false) =>
                        complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                      case scala.util.Failure(_) =>
                        complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                    }
                  case scala.util.Failure(_) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                }

              case None =>
                onComplete(permissionRepo.hasPublicViewerGrant(resourceType, resourceId)).flatMap {
                  case scala.util.Success(true) =>
                    provide(ResourceAccess.Viewer)
                  case scala.util.Success(false) =>
                    onComplete(tokenAuthorizes).flatMap {
                      case scala.util.Success(true) =>
                        provide(ResourceAccess.Viewer)
                      case scala.util.Success(false) =>
                        complete(StatusCodes.NotFound, ErrorResponse(notFoundMessage))
                      case scala.util.Failure(_) =>
                        complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                    }
                  case scala.util.Failure(_) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                }
            }

          case scala.util.Failure(_) =>
            complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
        }
    }
  }
}
