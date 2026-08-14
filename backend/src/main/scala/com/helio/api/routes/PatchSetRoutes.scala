package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.PatchSet
import com.helio.domain.AuthenticatedUser
import com.helio.services.PatchSetApplyService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/patch-sets/apply` (HEL-406).
 *
 *  Applies a reviewed `PatchSet` (HEL-403) atomically — thin route shell,
 *  mirrors `CombinedProposalRoutes.scala`'s structure exactly.
 *  `PatchSetApplyService` holds all the pre-validation/forward-apply/
 *  rollback logic (no direct DB access here, RLS enforced via the same
 *  `AccessChecker`/repo lookups every mutated resource's real route uses).
 *  A NEW top-level `patch-sets` prefix (mirrors `proposals`, HEL-387's D6) —
 *  shares no path space with any existing route. */
final class PatchSetRoutes(
    patchSetApplyService: PatchSetApplyService,
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
      }
    }
}
