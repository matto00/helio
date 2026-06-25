package com.helio.services

import com.helio.api.protocols.GrantPermissionRequest
import com.helio.domain._
import com.helio.infrastructure.ResourcePermissionRepository
import org.postgresql.util.PSQLException

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/pipelines/:id/permissions`.
 *
 *  Mirrors [[PermissionService]] exactly but hard-codes `ResourceType = "pipeline"`
 *  and disallows public-viewer (anonymous) grants — no `granteeId = None` path.
 *
 *  ACL is enforced via [[AccessChecker.requireOwnerOnly]]; only the pipeline
 *  owner may list / grant / revoke. */
final class PipelinePermissionService(
    permissionRepo: ResourcePermissionRepository,
    accessChecker:  AccessChecker
)(implicit ec: ExecutionContext) {

  private val ResourceType = "pipeline"

  def list(pipelineId: String, user: AuthenticatedUser): Future[Either[ServiceError, Vector[ResourcePermission]]] =
    accessChecker.requireOwnerOnly(ResourceType, pipelineId, user, "Pipeline not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  => permissionRepo.findByResource(ResourceType, pipelineId).map(Right(_))
    }

  def grant(pipelineId: String, request: GrantPermissionRequest, user: AuthenticatedUser): Future[Either[ServiceError, ResourcePermission]] =
    accessChecker.requireOwnerOnly(ResourceType, pipelineId, user, "Pipeline not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        // No public-viewer (anonymous) grants for pipelines.
        if (request.granteeId.isEmpty)
          Future.successful(Left(ServiceError.BadRequest("granteeId is required for pipeline grants (no anonymous access)")))
        else
          Role.fromString(request.role) match {
            case Left(error) => Future.successful(Left(ServiceError.BadRequest(error)))
            case Right(role) =>
              val permission = ResourcePermission(
                resourceType = ResourceType,
                resourceId   = pipelineId,
                granteeId    = request.granteeId.map(UserId(_)),
                role         = role,
                createdAt    = Instant.now()
              )
              permissionRepo.insert(permission)
                .map(created => Right(created))
                .recover {
                  case _: PSQLException => Left(ServiceError.Conflict("Permission already exists"))
                }
          }
    }

  def revoke(pipelineId: String, granteeId: UserId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    accessChecker.requireOwnerOnly(ResourceType, pipelineId, user, "Pipeline not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        permissionRepo.delete(ResourceType, pipelineId, granteeId).map {
          case true  => Right(())
          case false => Left(ServiceError.NotFound("Permission not found"))
        }
    }
}
