package com.helio.api.routes

import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{JsonProtocols, TeardownRequest}
import com.helio.domain.AuthenticatedUser
import com.helio.services.{WorkspaceContextService, WorkspaceTeardownService}

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `/api/workspace`. Teardown logic lives in
 *  [[WorkspaceTeardownService]] (HEL-366); context-assembly logic lives in
 *  [[WorkspaceContextService]] (HEL-371). New top-level route prefix — no
 *  existing route collides (design.md Risks/Trade-offs).
 *
 *  `workspaceTeardownService` stays `Option`-guarded (HEL-366 — needs a raw
 *  `DbContext`, nullable in some fixtures/deployments) while
 *  `workspaceContextService` is a required, unconditional dependency
 *  (design.md D2 — every dependency it needs is already constructed
 *  unconditionally in `ApiRoutes`). Splitting the two lets `GET .../context`
 *  stay reachable even when `dbContext` is absent and `.../teardown` 404s. */
class WorkspaceRoutes(
    workspaceTeardownServiceOpt: Option[WorkspaceTeardownService],
    workspaceContextService: WorkspaceContextService,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("workspace") {
      concat(
        path("teardown") {
          post {
            entity(as[TeardownRequest]) { req =>
              workspaceTeardownServiceOpt.fold(reject: Route) { svc =>
                ServiceResponse.run(svc.teardown(req, user))(identity)
              }
            }
          }
        },
        path("context") {
          get {
            onSuccess(workspaceContextService.assemble(user)) { resp =>
              complete(resp)
            }
          }
        }
      )
    }
}
