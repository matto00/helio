package com.helio.api.routes.dashboards

import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.dashboards.DashboardChangesResponse
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.dashboards.DashboardChangesService

/** `GET /api/dashboard-changes?ids=a,b` (HEL-1575). A top-level path on purpose, so it can never collide with the
 *  `/api/dashboards/:id/...` matchers. */
class DashboardChangesRoutes(service: DashboardChangesService, user: AuthenticatedUser) extends JsonProtocols {

  val routes: Route =
    path("dashboard-changes") {
      get {
        parameter("ids") { ids =>
          ServiceResponse.run(service.changes(ids, user)) { case (serverNow, items) =>
            DashboardChangesResponse.fromDomain(serverNow, items)
          }
        }
      }
    }
}
