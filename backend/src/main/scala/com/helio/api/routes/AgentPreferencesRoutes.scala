package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.{AgentPreferencesResponse, PutAgentPreferencesRequest, PutMemoryEnabledRequest}
import com.helio.domain.AuthenticatedUser
import com.helio.services.AgentPreferencesService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `GET`/`PUT /api/preferences` (HEL-472 / 420-A) plus the dedicated
 *  `PUT /api/preferences/memory-enabled` (HEL-531 / 420-E design.md Decision 1). All logic lives
 *  in [[AgentPreferencesService]]; unlike most route classes in this package, no method here can
 *  fail (no ownership check, no validation), so this uses a bare `onSuccess` rather than
 *  `ServiceResponse.run` -- there is no `ServiceError` branch to bridge. */
class AgentPreferencesRoutes(
    agentPreferencesService: AgentPreferencesService,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("preferences") {
      concat(
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
        },
        path("memory-enabled") {
          put {
            entity(as[PutMemoryEnabledRequest]) { req =>
              onSuccess(agentPreferencesService.setMemoryEnabled(user, req.memoryEnabled)) { prefs =>
                complete(StatusCodes.OK, AgentPreferencesResponse.fromDomain(prefs))
              }
            }
          }
        }
      )
    }
}
