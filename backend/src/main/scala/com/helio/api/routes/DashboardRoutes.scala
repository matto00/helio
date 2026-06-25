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
              parameters("offset".as[Int].withDefault(Page.Default.offset), "limit".as[Int].withDefault(Page.Default.limit)) { (offsetRaw, limitRaw) =>
                if (offsetRaw < 0)
                  complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
                else {
                  val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                  onSuccess(dashboardService.findAll(user, page)) { result =>
                    complete(PagedResult(result.items.map(DashboardResponse.fromDomain), result.total, result.offset, result.limit))
                  }
                }
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
                panels    = panels.map(p => PanelResponse.fromDomain(p))
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
