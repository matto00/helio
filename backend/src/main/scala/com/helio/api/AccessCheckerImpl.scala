package com.helio.api

import com.helio.domain.{AuthenticatedUser, ResourceAccess, Role}
import com.helio.infrastructure.ResourcePermissionRepository
import com.helio.services.{AccessChecker, ServiceError}

import scala.concurrent.{ExecutionContext, Future}

/** Concrete `AccessChecker` backed by the same `ResourceTypeRegistry` and
 *  `ResourcePermissionRepository` that the HTTP-layer `AclDirective` uses.
 *
 *  Logic is intentionally identical to `AclDirective.authorizeResource` /
 *  `authorizeResourceWithSharing` — only the return type differs. Each branch
 *  there maps to the corresponding `Right` / `Left[ServiceError]` here so the
 *  observable behaviour is unchanged when services are called instead of
 *  directives. */
final class AccessCheckerImpl(
    permissionRepo: ResourcePermissionRepository,
    registry: ResourceTypeRegistry
)(implicit ec: ExecutionContext)
    extends AccessChecker {

  override def requireOwnerOnly(
      resourceType: String,
      resourceId: String,
      user: AuthenticatedUser,
      notFoundMessage: String
  ): Future[Either[ServiceError, ResourceAccess]] =
    registry.lookup(resourceType) match {
      case None =>
        Future.successful(Left(ServiceError.InternalError(s"Unknown resource type: $resourceType")))
      case Some(rt) =>
        rt.ownerResolver(resourceId).map {
          case None =>
            Left(ServiceError.NotFound(notFoundMessage))
          case Some(ownerId) if ownerId != user.id.value =>
            Left(ServiceError.Forbidden())
          case Some(_) =>
            Right(ResourceAccess.Owner)
        }
    }

  override def requireAccess(
      resourceType: String,
      resourceId: String,
      userOpt: Option[AuthenticatedUser],
      notFoundMessage: String
  ): Future[Either[ServiceError, ResourceAccess]] =
    registry.lookup(resourceType) match {
      case None =>
        Future.successful(Left(ServiceError.InternalError(s"Unknown resource type: $resourceType")))
      case Some(rt) =>
        rt.ownerResolver(resourceId).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(notFoundMessage)))

          case Some(ownerId) =>
            userOpt match {
              case Some(user) if user.id.value == ownerId =>
                Future.successful(Right(ResourceAccess.Owner))

              case Some(user) =>
                permissionRepo.findGrant(resourceType, resourceId, user.id).map {
                  case Some(grant) =>
                    grant.role match {
                      case Role.Editor => Right(ResourceAccess.Editor)
                      case Role.Viewer => Right(ResourceAccess.Viewer)
                    }
                  case None =>
                    Left(ServiceError.Forbidden())
                }

              case None =>
                permissionRepo.hasPublicViewerGrant(resourceType, resourceId).map {
                  case true  => Right(ResourceAccess.Viewer)
                  case false => Left(ServiceError.NotFound(notFoundMessage))
                }
            }
        }
    }
}
