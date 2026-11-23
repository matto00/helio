package com.helio.api.routes.auth

import com.helio.api.protocols.IdParsing.McpRefreshFamilyIdSegment
import com.helio.api.JsonProtocols
import com.helio.api.protocols.auth.{McpRefreshFamilyCreateRequest, McpRefreshFamilyConflictResponse, McpRefreshFamilyRotateRequest}
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.auth.McpRefreshFamilyService
import com.helio.services.auth.McpRefreshFamilyService.RotateResult
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}

/** Refresh-token family state for the helio-mcp connector (HEL-1713): `POST /api/mcp-refresh-families`
 *  and `POST /api/mcp-refresh-families/:id/rotate`. Mounted in the authenticated block; only a PAT is
 *  admitted (a session caller gets `403` from the service), and `confineScopedToken` already refuses a
 *  scoped PAT everywhere but `/api/hooks`. */
final class McpRefreshFamilyRoutes(
    service: McpRefreshFamilyService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  val routes: Route =
    pathPrefix("mcp-refresh-families") {
      concat(
        pathEndOrSingleSlash {
          post {
            entity(as[McpRefreshFamilyCreateRequest]) { request =>
              ServiceResponse.run(service.create(request, user)) { created => StatusCodes.Created -> created }
            }
          }
        },
        path(McpRefreshFamilyIdSegment / "rotate") { familyId =>
          post {
            entity(as[McpRefreshFamilyRotateRequest]) { request =>
              ServiceResponse.run(service.rotate(familyId, request, user)) {
                case RotateResult.Rotated(response) => StatusCodes.OK -> response
                case RotateResult.Refused(reason)   => StatusCodes.Conflict -> McpRefreshFamilyConflictResponse(reason)
              }
            }
          }
        }
      )
    }
}
