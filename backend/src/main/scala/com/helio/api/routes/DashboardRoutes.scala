package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DashboardIdSegment
import com.helio.domain._
import com.helio.services.DashboardService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/dashboards`. Business logic lives in
 *  [[com.helio.services.DashboardService]]; this file only handles path
 *  matching, unmarshalling, and translating `ServiceError → HTTP`. */
final class DashboardRoutes(
    dashboardService: DashboardService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onSuccess(dashboardService.findAll(user)) { dashboards =>
                complete(DashboardsResponse(items = dashboards.map(DashboardResponse.fromDomain)))
              }
            },
            post {
              entity(as[CreateDashboardRequest]) { request =>
                onSuccess(dashboardService.create(DashboardService.CreateDashboardInput(request.name), user)) { created =>
                  complete(StatusCodes.Created, DashboardResponse.fromDomain(created))
                }
              }
            }
          )
        },
        path(DashboardIdSegment / "duplicate") { dashboardId =>
          post {
            ServiceResponse.run(dashboardService.duplicate(dashboardId, user)) { case (dashboard, panels) =>
              StatusCodes.Created -> DuplicateDashboardResponse(
                dashboard = DashboardResponse.fromDomain(dashboard),
                panels    = panels.map(PanelResponse.fromDomain)
              )
            }
          }
        },
        path(DashboardIdSegment / "update") { dashboardId =>
          patch {
            entity(as[UpdateDashboardBatchRequest]) { request =>
              ServiceResponse.run(dashboardService.update(dashboardId, request.dashboard, user))(DashboardResponse.fromDomain)
            }
          }
        },
        path(DashboardIdSegment) { dashboardId =>
          concat(
            delete {
              ServiceResponse.runNoContent(dashboardService.delete(dashboardId, user))
            },
            patch {
              entity(as[UpdateDashboardRequest]) { request =>
                ServiceResponse.run(dashboardService.update(dashboardId, request, user))(DashboardResponse.fromDomain)
              }
            }
          )
        }
      )
    }
}
