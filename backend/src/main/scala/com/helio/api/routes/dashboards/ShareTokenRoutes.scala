package com.helio.api.routes.dashboards

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.domain.model.{AuthenticatedUser, ShareTokenId}
import com.helio.services.sharing.ShareTokenService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/dashboards/:id/share-tokens` -- owner-only create/list/revoke.
 *  All logic in [[ShareTokenService]], mirroring `PermissionRoutes`. */
final class ShareTokenRoutes(
    shareTokenService: ShareTokenService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards" / Segment / "share-tokens") { dashboardId =>
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              ServiceResponse.run(shareTokenService.list(dashboardId, user)) { tokens =>
                ShareTokensResponse(tokens.map(ShareTokenResponse.fromDomain))
              }
            },
            post {
              entity(as[CreateShareTokenRequest]) { request =>
                ServiceResponse.run(shareTokenService.create(dashboardId, request, user)) { created =>
                  StatusCodes.Created -> created
                }
              }
            }
          )
        },
        path(Segment) { tokenId =>
          delete {
            ServiceResponse.runNoContent(shareTokenService.revoke(dashboardId, ShareTokenId(tokenId), user))
          }
        }
      )
    }
}
