package com.helio.api.http

import com.helio.domain.model.{AuthenticatedUser, ResourceAccess, Role}
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.services.auth.AccessChecker
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** Concrete `AccessChecker` backed by the same `ResourceTypeRegistry` and
 *  `ResourcePermissionRepository` that the HTTP-layer `AclDirective` uses.
 *
 *  Existence-not-leaked (HEL-1002): a caller with NO grant at all on a real resource is denied with
 *  exactly the `NotFound(notFoundMessage)` an absent resource produces, so the two are
 *  indistinguishable. `Forbidden` is reserved for a caller who already holds a grant (and so
 *  already knows the resource exists) but lacks the privilege for the operation.
 *
 *  Differs from `AclDirective` in one deliberate place: for `requireOwnerOnly` the directive layer
 *  has no grant lookup, so a grantee there gets 404; here a grantee gets 403. */
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
        rt.ownerResolver(resourceId).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(notFoundMessage)))
          case Some(ownerId) if ownerId != user.id.value =>
            // A grantee can already see the resource (403 reveals nothing new); anyone else gets the
            // absent-resource response. One extra indexed query, only on this foreign path.
            permissionRepo.findGrant(resourceType, resourceId, user.id).map {
              case Some(_) => Left(ServiceError.Forbidden())
              case None    => Left(ServiceError.NotFound(notFoundMessage))
            }
          case Some(_) =>
            Future.successful(Right(ResourceAccess.Owner))
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
                    Left(ServiceError.NotFound(notFoundMessage))
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
