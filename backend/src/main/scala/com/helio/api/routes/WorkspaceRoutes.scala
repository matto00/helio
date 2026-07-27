package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols, TeardownRequest}
import com.helio.domain.AuthenticatedUser
import com.helio.services.{WorkspaceContextBudget, WorkspaceContextService, WorkspaceTeardownService}

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
            // HEL-377 design.md D7: optional `budgetBytes` query param —
            // mirrors DataTypeRoutes'/DataSourceRoutes' offset/limit pattern
            // (`parameters(...).as[Int]`, explicit negative-value rejection).
            // No upper clamp (D7) — an arbitrarily large requested budget
            // only skips trimming, costing nothing extra beyond the existing
            // per-request caps `assemble` already enforces. Omitting the
            // param falls back to `WorkspaceContextBudget.DefaultBudgetBytes`.
            parameters("budgetBytes".as[Int].optional) { budgetBytesOpt =>
              if (budgetBytesOpt.exists(_ < 0))
                complete(StatusCodes.BadRequest, ErrorResponse("budgetBytes must not be negative"))
              else {
                val budgetBytes = budgetBytesOpt.getOrElse(WorkspaceContextBudget.DefaultBudgetBytes)
                onSuccess(workspaceContextService.assemble(user, budgetBytes)) { resp =>
                  complete(resp)
                }
              }
            }
          }
        }
      )
    }
}
