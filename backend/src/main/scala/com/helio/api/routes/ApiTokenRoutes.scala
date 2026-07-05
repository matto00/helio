package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.ApiTokenIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.ApiTokenService

import scala.concurrent.ExecutionContextExecutor

/** Personal Access Token management (HEL-148 Phase 1): `/api/tokens`.
 *
 *  Mounted inside the authenticated block — a PAT is created while logged in
 *  (session or an existing PAT). Token minting/hashing lives in
 *  [[ApiTokenService]]; the raw token appears only in the creation response. */
final class ApiTokenRoutes(
    apiTokenService: ApiTokenService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("tokens") {
      concat(
        pathEndOrSingleSlash {
          concat(
            post {
              entity(as[CreateApiTokenRequest]) { request =>
                ServiceResponse.run(apiTokenService.create(request, user)) { created =>
                  StatusCodes.Created -> created
                }
              }
            },
            get {
              ServiceResponse.run(apiTokenService.list(user))(identity)
            }
          )
        },
        path(ApiTokenIdSegment) { tokenId =>
          delete {
            ServiceResponse.runNoContent(apiTokenService.revoke(tokenId, user))
          }
        }
      )
    }
}
