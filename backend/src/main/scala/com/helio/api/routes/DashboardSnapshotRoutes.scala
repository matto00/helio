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

/** Thin HTTP shell for `/api/dashboards/:id/export` and `/api/dashboards/import`.
 *  Validation + repository orchestration live in [[DashboardService]]. */
final class DashboardSnapshotRoutes(
    dashboardService: DashboardService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards") {
      concat(
        path(DashboardIdSegment / "export") { dashboardId =>
          get {
            ServiceResponse.run(dashboardService.exportSnapshot(dashboardId, user))(identity)
          }
        },
        path("import") {
          post {
            entity(as[DashboardSnapshotPayload]) { payload =>
              ServiceResponse.run(dashboardService.importSnapshot(payload, user)) { case (dashboard, panels) =>
                StatusCodes.Created -> DuplicateDashboardResponse(
                  dashboard = DashboardResponse.fromDomain(dashboard),
                  panels    = panels.map(PanelResponse.fromDomain)
                )
              }
            }
          }
        }
      )
    }
}
