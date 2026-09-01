package com.helio.api.routes.dashboards

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DashboardIdSegment
import com.helio.domain.model._
import com.helio.services.dashboards.DashboardService
import com.helio.api.http.RequestValidation

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
                // HEL-907 evaluator-2: `DashboardService.create` returns `Future[(Dashboard,
                // Boolean)]`, no `Either`/`ServiceError` convention (unlike DataSourceService/
                // PipelineService, which gate `tag` via `RequestValidation.validateTag` inside
                // the service itself) -- rather than widen that signature (a breaking ripple
                // through DashboardProposalService/PatchSetApplyForward/every other caller for
                // one field), the same curated-400 gate this file already applies to `offset`
                // above is applied here, at the route layer, before ever calling the service.
                RequestValidation.validateTag(request.tag) match {
                  case Left(msg) => complete(StatusCodes.BadRequest, ErrorResponse(msg))
                  case Right(tag) =>
                    val input = DashboardService.CreateDashboardInput(request.name, request.ifExists, tag)
                    onSuccess(dashboardService.create(input, user)) {
                      // HEL-363: `created = false` means `ifExists: "return"` matched an
                      // existing dashboard by name — 200, not 201 (nothing was created).
                      case (dashboard, created) =>
                        val status = if (created) StatusCodes.Created else StatusCodes.OK
                        complete(status, DashboardResponse.fromDomain(dashboard))
                    }
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
