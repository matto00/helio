package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.PanelIdSegment
import com.helio.domain._
import com.helio.services.PanelService

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/panels`. All validation, ACL, and patch
 *  composition lives in [[com.helio.services.PanelService]] (which absorbed
 *  the prior `PanelPatchService`). */
final class PanelRoutes(
    panelService: PanelService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("panels") {
      concat(
        path("updateBatch") {
          post {
            entity(as[UpdatePanelsBatchRequest]) { request =>
              ServiceResponse.run(panelService.batchUpdate(request.panels, user)) { updated =>
                UpdatePanelsBatchResponse(updated.map(PanelResponse.fromDomain))
              }
            }
          }
        },
        pathEndOrSingleSlash {
          post {
            entity(as[CreatePanelRequest]) { request =>
              ServiceResponse.run(panelService.create(request, user)) { created =>
                StatusCodes.Created -> PanelResponse.fromDomain(created)
              }
            }
          }
        },
        path(PanelIdSegment) { panelId =>
          concat(
            delete {
              ServiceResponse.runNoContent(panelService.delete(panelId, user))
            },
            patch {
              entity(as[UpdatePanelRequest]) { request =>
                ServiceResponse.run(panelService.update(panelId, request, user))(PanelResponse.fromDomain)
              }
            }
          )
        },
        path(PanelIdSegment / "query") { panelId =>
          get {
            onSuccess(panelService.findById(panelId, Some(user))) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
              case Some(panel) =>
                panel.buildQuery match {
                  case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel is not bound to a data type"))
                  case Some(query) => complete(query)
                }
            }
          }
        },
        path(PanelIdSegment / "duplicate") { panelId =>
          post {
            ServiceResponse.run(panelService.duplicate(panelId, user)) { panel =>
              StatusCodes.Created -> PanelResponse.fromDomain(panel)
            }
          }
        }
      )
    }
}
