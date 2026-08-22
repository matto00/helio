package com.helio.api.routes.patchsets

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.IdParsing.PatchSetApplicationIdSegment
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.patchsets.PatchSetUndoService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/patch-sets/:id/undo` (HEL-413 design.md D6) — a NEW route, mounted beside the
 *  existing `PatchSetRoutes` (own file since the id is a `PatchSetApplicationId` path segment,
 *  unlike `apply`/`preview`'s bare `PatchSet`-in-body shape). Thin route shell — all pre-
 *  validation/conflict-check/restore logic lives in `PatchSetUndoService`. */
final class PatchSetUndoRoutes(
    patchSetUndoService: PatchSetUndoService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("patch-sets" / PatchSetApplicationIdSegment / "undo") { applicationId =>
      post {
        ServiceResponse.run(patchSetUndoService.undo(applicationId, user)) { response =>
          StatusCodes.OK -> response
        }
      }
    }
}
