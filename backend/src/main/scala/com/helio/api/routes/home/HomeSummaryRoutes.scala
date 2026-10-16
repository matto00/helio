package com.helio.api.routes.home

import com.helio.api.JsonProtocols
import com.helio.api.routes.ServiceResponse
import com.helio.api.protocols.home.HomeSummaryResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.home.HomeSummaryService
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `GET /api/home-summary` (HEL-1578). Top-level path so it can never collide with the
 *  `/api/pipelines/:id/...` matchers. */
class HomeSummaryRoutes(service: HomeSummaryService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    path("home-summary") {
      get {
        // `dashboardIds` (comma-separated, at most 20) selects which dashboards' change times come back.
        parameter("dashboardIds".?) { ids =>
          ServiceResponse.run(service.summary(user, ids))(HomeSummaryResponse.fromDomain)
        }
      }
    }
}
