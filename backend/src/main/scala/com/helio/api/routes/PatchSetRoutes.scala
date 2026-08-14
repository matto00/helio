package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.PatchSet
import com.helio.domain.AuthenticatedUser
import com.helio.services.{PatchSetApplyService, PatchSetPreviewService}

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/patch-sets/apply` (HEL-406) + `POST /api/patch-sets/preview`
 *  (HEL-408, design.md D5 — added to this EXISTING file alongside `/apply`,
 *  no new route file).
 *
 *  Applies/previews a reviewed `PatchSet` (HEL-403) — thin route shell,
 *  mirrors `CombinedProposalRoutes.scala`'s structure exactly.
 *  `PatchSetApplyService`/`PatchSetPreviewService` hold all the
 *  pre-validation/forward-apply/rollback (or, for preview, projection)
 *  logic (no direct DB access here, RLS enforced via the same
 *  `AccessChecker`/repo lookups every mutated resource's real route uses).
 *  A NEW top-level `patch-sets` prefix (mirrors `proposals`, HEL-387's D6) —
 *  shares no path space with any existing route. */
final class PatchSetRoutes(
    patchSetApplyService: PatchSetApplyService,
    patchSetPreviewService: PatchSetPreviewService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("patch-sets") {
      path("apply") {
        post {
          entity(as[PatchSet]) { patchSet =>
            ServiceResponse.run(patchSetApplyService.apply(patchSet, user)) { response =>
              StatusCodes.OK -> response
            }
          }
        }
      } ~
      path("preview") {
        post {
          entity(as[PatchSet]) { patchSet =>
            ServiceResponse.run(patchSetPreviewService.preview(patchSet, user)) { response =>
              StatusCodes.OK -> response
            }
          }
        }
      }
    }
}
