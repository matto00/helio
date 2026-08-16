package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.{AgentPreferencesResponse, PutAgentPreferencesRequest}
import com.helio.domain.AuthenticatedUser
import com.helio.services.AgentPreferencesService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `GET`/`PUT /api/preferences` (HEL-472 / 420-A). All logic lives in
 *  [[AgentPreferencesService]]; unlike most route classes in this package, neither method can
 *  fail (no ownership check, no validation), so this uses a bare `onSuccess` rather than
 *  `ServiceResponse.run` -- there is no `ServiceError` branch to bridge. */
class AgentPreferencesRoutes(
    agentPreferencesService: AgentPreferencesService,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("preferences") {
      pathEndOrSingleSlash {
        concat(
          get {
            onSuccess(agentPreferencesService.get(user)) { prefs =>
              complete(StatusCodes.OK, AgentPreferencesResponse.fromDomain(prefs))
            }
          },
          put {
            entity(as[PutAgentPreferencesRequest]) { req =>
              onSuccess(agentPreferencesService.put(user, req)) { prefs =>
                complete(StatusCodes.OK, AgentPreferencesResponse.fromDomain(prefs))
              }
            }
          }
        )
      }
    }
}
