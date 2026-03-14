package com.helio.api

import akka.actor.typed.ActorRef
import akka.actor.typed.ActorSystem
import akka.actor.typed.scaladsl.AskPattern._
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import akka.util.Timeout
import com.helio.app.DashboardRegistryActor
import com.helio.app.PanelRegistryActor
import com.helio.domain.Dashboard
import com.helio.domain.DashboardId
import com.helio.domain.Panel

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.Future
import scala.concurrent.duration.DurationInt

final class ApiRoutes(
    dashboardRegistry: ActorRef[DashboardRegistryActor.Command],
    panelRegistry: ActorRef[PanelRegistryActor.Command]
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val timeout: Timeout = 3.seconds
  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    path("health") {
      get {
        complete(HealthResponse(status = "ok"))
      }
    } ~
      pathPrefix("api" / "dashboards") {
        concat(
          pathEndOrSingleSlash {
            get {
              onSuccess(fetchDashboards()) { dashboards =>
                complete(DashboardsResponse(items = dashboards.map(DashboardResponse.fromDomain)))
              }
            }
          },
          path(Segment / "panels") { dashboardId =>
            get {
              onSuccess(fetchPanels(DashboardId(dashboardId))) { panels =>
                complete(PanelsResponse(items = panels.map(PanelResponse.fromDomain)))
              }
            }
          }
        )
      }

  private def fetchDashboards(): Future[Vector[Dashboard]] =
    dashboardRegistry.ask(DashboardRegistryActor.GetDashboards.apply).map(_.items)

  private def fetchPanels(dashboardId: DashboardId): Future[Vector[Panel]] =
    panelRegistry.ask(PanelRegistryActor.GetPanelsForDashboard(dashboardId, _)).map(_.items)
}
