package com.helio.api.routes.firstrun

import com.helio.api.JsonProtocols
import com.helio.api.protocols.firstrun.{FirstRunDashboardRequest, FirstRunTemplateRequest}
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.{AuthenticatedUser, DataSourceId}
import com.helio.services.firstrun.FirstRunDashboardService
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}

/** `POST /api/first-run/dashboard` (HEL-1209) and `POST /api/first-run/template` (HEL-1210). Authenticated and ownership-checked, deliberately NOT
 *  tier-gated: the first run is non-AI for every tier. */
final class FirstRunRoutes(
    service: FirstRunDashboardService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  val routes: Route =
    pathPrefix("first-run") {
      concat(
        path("dashboard") {
          post {
            entity(as[FirstRunDashboardRequest]) { req =>
              ServiceResponse.run(service.build(DataSourceId(req.sourceId), user))(StatusCodes.Created -> _)
            }
          }
        },
        path("template") {
          post {
            entity(as[FirstRunTemplateRequest]) { req =>
              ServiceResponse.run(service.buildTemplate(req.template, user))(StatusCodes.Created -> _)
            }
          }
        }
      )
    }
}
