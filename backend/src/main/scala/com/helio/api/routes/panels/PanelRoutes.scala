package com.helio.api.routes.panels

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.PanelIdSegment
import com.helio.api.protocols.panels.{FieldValidationError, FieldValidationErrorResponse, FormSubmitRequest}
import com.helio.api.protocols.sources.RowWriteResponse
import com.helio.domain.model._
import com.helio.services.FormSubmitError
import com.helio.services.panels.PanelService
import com.helio.services.sources.RowWriteResult

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

  /** HEL-1087 design.md D5: route-local completion for `submitForm` — NOT `ServiceResponse.run`,
   *  whose `completeError` hardcodes the generic `ErrorResponse` and has no way to thread
   *  `fieldErrors` through it (`DashboardAuthoringRoutes.completeAuthoring` is the precedent for
   *  this exact shape). Reuses `ServiceResponse.statusCodeFor` so the status-code mapping is never
   *  duplicated — only the response BODY shape diverges, and only when `fieldErrors` is
   *  non-empty; every other failure (403/404/non-form-400) renders the same bare
   *  `ErrorResponse(message)` every other route already emits. */
  private def completeSubmit(result: Future[Either[FormSubmitError, RowWriteResult]]): Route =
    onSuccess(result) {
      case Right(r) => complete(StatusCodes.Created, RowWriteResponse.fromDomain(r))
      case Left(FormSubmitError(err, fieldErrors)) if fieldErrors.nonEmpty =>
        complete(
          ServiceResponse.statusCodeFor(err),
          FieldValidationErrorResponse(err.message, fieldErrors.map(e => FieldValidationError(e.field, e.reason)))
        )
      case Left(FormSubmitError(err, _)) =>
        complete(ServiceResponse.statusCodeFor(err), ErrorResponse(err.message))
    }

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
              ServiceResponse.run(panelService.create(request, user)) { case (created, layout) =>
                StatusCodes.Created -> PanelResponse.fromDomain(
                  created,
                  layout = layout.map(item => PanelLayoutResponse(x = item.x, y = item.y, w = item.w, h = item.h))
                )
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
        // `GET /api/panels/:id/query` removed outright (HEL-904 task 4.1) —
        // HEL-292 panel-level aggregation and this route are retired, not
        // carried over to Outputs (design.md line 195).
        path(PanelIdSegment / "duplicate") { panelId =>
          post {
            ServiceResponse.run(panelService.duplicate(panelId, user)) { panel =>
              StatusCodes.Created -> PanelResponse.fromDomain(panel)
            }
          }
        },
        // HEL-1087: `POST /api/panels/:id/submit` — a `form` panel's submit path. Placed
        // alongside `duplicate`, using the same `PanelIdSegment / "<segment>"` shape.
        path(PanelIdSegment / "submit") { panelId =>
          post {
            entity(as[FormSubmitRequest]) { request =>
              completeSubmit(panelService.submitForm(panelId, request.values.fields, user))
            }
          }
        }
      )
    }
}
