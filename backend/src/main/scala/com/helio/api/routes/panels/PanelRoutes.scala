package com.helio.api.routes.panels

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.PanelIdSegment
import com.helio.domain.model._
import com.helio.services.panels.PanelService

import scala.concurrent.{ExecutionContextExecutor, Future}

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
                UpdatePanelsBatchResponse(updated.map(p => PanelResponse.fromDomain(p)))
              }
            }
          }
        },
        // HEL-370: placed before `pathEndOrSingleSlash`/`path(PanelIdSegment)`,
        // mirroring `updateBatch`'s placement above — a literal "batch" segment
        // must never be shadowed by the `PanelIdSegment` matcher.
        path("batch") {
          post {
            entity(as[CreatePanelsBatchRequest]) { request =>
              ServiceResponse.run(panelService.batchCreate(request, user)) { created =>
                StatusCodes.Created -> CreatePanelsBatchResponse(created.map(p => PanelResponse.fromDomain(p)))
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
                ServiceResponse.run(panelService.update(panelId, request, user))(p => PanelResponse.fromDomain(p))
              }
            }
          )
        },
        path(PanelIdSegment / "query") { panelId =>
          get {
            // HEL-500: resolve bindings (cross-user dataTypeId/metricId
            // clearing + MetricPanel effective-binding materialization,
            // design.md D3/D4) before building the query — this was
            // previously the one panel-read path that skipped resolution
            // entirely.
            val resolved = panelService.findById(panelId, Some(user)).flatMap {
              case None        => Future.successful(None)
              case Some(panel) => panelService.resolveBinding(panel, user).map(Some(_))
            }
            onSuccess(resolved) {
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
