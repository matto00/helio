package com.helio.api.routes.hooks

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{HookRunRequest, JsonProtocols}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, TokenScope}
import com.helio.services.hooks.HookTriggerService

import scala.concurrent.ExecutionContext

/** `POST /api/hooks/run` (HEL-369) — the external-trigger entrypoint.
 *  Authenticated by session or PAT (scoped or unscoped) via `ApiRoutes`'s
 *  `authenticate` branch; `tokenScope` is the `Option[TokenScope]` extracted
 *  by `AuthDirectives.confineScopedToken` one level up, threaded in here so
 *  a scoped token's pipeline allow-list can be enforced (design.md
 *  Decision 2/4). Thin HTTP shell: dispatches to [[HookTriggerService.trigger]]
 *  and translates the service's `ServiceError` channel via
 *  [[ServiceResponse]]. */
final class HookRoutes(
    hookTriggerService: HookTriggerService,
    user: AuthenticatedUser,
    tokenScope: Option[TokenScope]
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("hooks" / "run") {
      pathEndOrSingleSlash {
        post {
          entity(as[HookRunRequest]) { req =>
            ServiceResponse.run(hookTriggerService.trigger(PipelineId(req.pipelineId), user, tokenScope)) { result =>
              StatusCodes.OK -> result
            }
          }
        }
      }
    }
}
