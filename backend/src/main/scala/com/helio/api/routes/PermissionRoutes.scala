package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.api.protocols.IdParsing.UserIdSegment
import com.helio.domain._
import com.helio.services.PermissionService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/dashboards/:id/permissions`.
 *  All logic in [[PermissionService]]. */
final class PermissionRoutes(
    permissionService: PermissionService,
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
              ServiceResponse.run(permissionService.list(dashboardId, user)) { permissions =>
                PermissionsResponse(permissions.map(PermissionResponse.fromDomain))
              }
            },
            post {
              entity(as[GrantPermissionRequest]) { request =>
                ServiceResponse.run(permissionService.grant(dashboardId, request, user)) { created =>
                  StatusCodes.Created -> PermissionResponse.fromDomain(created)
                }
              }
            }
          )
        },
        path(UserIdSegment) { granteeId =>
          delete {
            ServiceResponse.runNoContent(permissionService.revoke(dashboardId, granteeId, user))
          }
        }
      )
    }
}
