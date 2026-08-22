package com.helio.api.routes.patchsets

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.marshalling.ToResponseMarshallable
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.proposals.{AuthoringError, AuthoringErrorKind}
import com.helio.services.patchsets.RefinementService

import scala.concurrent.{ExecutionContextExecutor, Future}

/** `POST /api/refinements` (design.md D5) — grounds Claude in a target dashboard/pipeline's real
 *  current live state and returns a validated `PatchSet`; never applies it. Buffered only
 *  (design.md Non-Goals — no `?stream=true` variant, unlike `DashboardAuthoringRoutes`). A NEW
 *  top-level `refinements` prefix — shares no path space with any existing route (mirrors
 *  `patch-sets`/`proposals`, HEL-406/HEL-387's own D6 precedent).
 *
 *  Reload-hydration for a refinement conversation reuses the EXISTING
 *  `GET /api/authoring/conversations/:id` (design.md D4, `DashboardAuthoringRoutes`) — no route of
 *  that shape is added here; `AuthoringConversationView`/`findDisplayById` were generalized to also
 *  carry a refinement conversation's `latestPatchSet` instead.
 *
 *  All orchestration lives in [[RefinementService]] — this is a thin HTTP shell.
 *
 *  `serviceOpt` is `None` when `ClaudeConfig.fromEnv()` failed (no `ANTHROPIC_API_KEY`) or no
 *  `DbContext` was configured (mirrors `dashboardAuthoringServiceOpt`'s identical gate in
 *  `ApiRoutes`) — `ApiRoutes` still mounts this route family unconditionally, and a request against
 *  it completes `503` explicitly (mirrors `DashboardAuthoringRoutes`'s own precedent) rather than
 *  `reject`-ing into a bare `404`, which would look like the path simply doesn't exist. */
final class RefinementRoutes(serviceOpt: Option[RefinementService], user: AuthenticatedUser)(implicit ec: ExecutionContextExecutor)
    extends JsonProtocols {

  private def unavailable: Route =
    complete(StatusCodes.ServiceUnavailable, ErrorResponse("Conversational refinement is not configured"))

  /** Mirrors `DashboardAuthoringRoutes.completeAuthoring` verbatim (HEL-401 design.md D1) — an
   *  `AuthoringError`-carrying result needs the bespoke `kind`-carrying response body
   *  `ServiceResponse.run`'s `completeError` can't express (it's `private` and hardcodes the generic
   *  `ErrorResponse`). Reuses `ServiceResponse.statusCodeFor` (already loosened to
   *  `private[routes]`) so the status-code mapping itself is never duplicated. */
  private def completeRefinement[A](result: Future[Either[AuthoringError, A]])(success: A => ToResponseMarshallable): Route =
    onSuccess(result) {
      case Right(a) => complete(success(a))
      case Left(AuthoringError(Some(kind), err, _)) =>
        complete(ServiceResponse.statusCodeFor(err), AuthoringErrorResponse(AuthoringErrorKind.wireName(kind), err.message))
      case Left(AuthoringError(None, err, _)) =>
        complete(ServiceResponse.statusCodeFor(err), ErrorResponse(err.message))
    }

  val routes: Route =
    path("refinements") {
      post {
        serviceOpt.fold(unavailable) { service =>
          entity(as[RefinementRequest]) { request =>
            completeRefinement(service.refine(request, user))(identity)
          }
        }
      }
    }
}
