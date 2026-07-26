package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain.AuthenticatedUser
import com.helio.services.BoundPanelService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/panels/bound` (HEL-364) — thin HTTP shell for the compound
 *  source -> pipeline -> run -> panel-bind op. All validation, orchestration,
 *  and cleanup lives in [[BoundPanelService]] — mirrors
 *  [[DashboardContentsRoutes]]'s/[[PanelRoutes]]'s shape. */
final class BoundPanelRoutes(
    boundPanelService: BoundPanelService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("panels" / "bound") {
      pathEndOrSingleSlash {
        post {
          entity(as[BoundPanelRequest]) { request =>
            ServiceResponse.run(boundPanelService.create(request, user)) { response =>
              StatusCodes.Created -> response
            }
          }
        }
      }
    }
}
