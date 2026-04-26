package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, ResourcePermissionRepository}

import java.time.Instant
import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success}

final class PermissionRoutes(
    dashboardRepo: DashboardRepository,
    permissionRepo: ResourcePermissionRepository,
    aclDirective: AclDirective,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards" / Segment / "permissions") { dashboardId =>
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              aclDirective.authorizeResource(dashboardId, user, "dashboard", "Dashboard not found") {
                onSuccess(permissionRepo.findByResource("dashboard", dashboardId)) { permissions =>
                  complete(PermissionsResponse(permissions.map(PermissionResponse.fromDomain)))
                }
              }
            },
            post {
              entity(as[GrantPermissionRequest]) { request =>
                aclDirective.authorizeResource(dashboardId, user, "dashboard", "Dashboard not found") {
                  Role.fromString(request.role) match {
                    case Left(error) =>
                      complete(StatusCodes.BadRequest, ErrorResponse(error))
                    case Right(role) =>
                      val granteeId = request.granteeId.map(UserId(_))
                      val permission = ResourcePermission(
                        resourceType = "dashboard",
                        resourceId   = dashboardId,
                        granteeId    = granteeId,
                        role         = role,
                        createdAt    = Instant.now()
                      )
                      onComplete(permissionRepo.insert(permission)) {
                        case Success(created) =>
                          complete(StatusCodes.Created, PermissionResponse.fromDomain(created))
                        case Failure(_: org.postgresql.util.PSQLException) =>
                          complete(StatusCodes.Conflict, ErrorResponse("Permission already exists"))
                        case Failure(ex) =>
                          complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
                      }
                  }
                }
              }
            }
          )
        },
        path(Segment) { granteeIdStr =>
          delete {
            aclDirective.authorizeResource(dashboardId, user, "dashboard", "Dashboard not found") {
              val granteeId = UserId(granteeIdStr)
              onSuccess(permissionRepo.delete("dashboard", dashboardId, granteeId)) { deleted =>
                if (deleted) {
                  complete(StatusCodes.NoContent)
                } else {
                  complete(StatusCodes.NotFound, ErrorResponse("Permission not found"))
                }
              }
            }
          }
        }
      )
    }
}
