package com.helio.services

import com.helio.api.protocols.GrantPermissionRequest
import com.helio.domain._
import com.helio.infrastructure.ResourcePermissionRepository

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/dashboards/:id/permissions`.
 *
 *  ACL is enforced via [[AccessChecker.requireOwnerOnly]]; only the dashboard
 *  owner may list / grant / revoke. Resource type is hard-coded `"dashboard"`
 *  because the permission surface is dashboard-scoped today — CS2c may
 *  generalize when more resource types gain sharing. */
final class PermissionService(
    permissionRepo: ResourcePermissionRepository,
    accessChecker:  AccessChecker
)(implicit ec: ExecutionContext) {

  private val ResourceType = "dashboard"

  def list(dashboardId: String, user: AuthenticatedUser): Future[Either[ServiceError, Vector[ResourcePermission]]] =
    accessChecker.requireOwnerOnly(ResourceType, dashboardId, user, "Dashboard not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  => permissionRepo.findByResource(ResourceType, dashboardId).map(Right(_))
    }

  def grant(dashboardId: String, request: GrantPermissionRequest, user: AuthenticatedUser): Future[Either[ServiceError, ResourcePermission]] =
    accessChecker.requireOwnerOnly(ResourceType, dashboardId, user, "Dashboard not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        Role.fromString(request.role) match {
          case Left(error) => Future.successful(Left(ServiceError.BadRequest(error)))
          case Right(role) =>
            val permission = ResourcePermission(
              resourceType = ResourceType,
              resourceId   = dashboardId,
              granteeId    = request.granteeId.map(UserId(_)),
              role         = role,
              createdAt    = Instant.now()
            )
            permissionRepo.insert(permission)
              .map(created => Right(created))
              .recover {
                case _: org.postgresql.util.PSQLException => Left(ServiceError.Conflict("Permission already exists"))
              }
        }
    }

  def revoke(dashboardId: String, granteeId: UserId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    accessChecker.requireOwnerOnly(ResourceType, dashboardId, user, "Dashboard not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        permissionRepo.delete(ResourceType, dashboardId, granteeId).map {
          case true  => Right(())
          case false => Left(ServiceError.NotFound("Permission not found"))
        }
    }
}
