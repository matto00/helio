package com.helio.api

import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.{Directive0, Directive1}
import akka.http.scaladsl.server.Directives._
import com.helio.domain.{AuthenticatedUser, ResourceAccess, Role}
import com.helio.infrastructure.ResourcePermissionRepository

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
    registry: ResourceTypeRegistry
)(implicit ec: ExecutionContext) extends JsonProtocols {

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
      notFoundMessage: String = "Not found"
  ): Directive1[ResourceAccess] =
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
                    complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                  case scala.util.Failure(_) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                }

              case None =>
                onComplete(permissionRepo.hasPublicViewerGrant(resourceType, resourceId)).flatMap {
                  case scala.util.Success(true) =>
                    provide(ResourceAccess.Viewer)
                  case scala.util.Success(false) =>
                    complete(StatusCodes.NotFound, ErrorResponse(notFoundMessage))
                  case scala.util.Failure(_) =>
                    complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
                }
            }

          case scala.util.Failure(_) =>
            complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
        }
    }
}
