package com.helio.api.routes

import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{JsonProtocols, TeardownRequest}
import com.helio.domain.AuthenticatedUser
import com.helio.services.WorkspaceTeardownService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `/api/workspace`. All logic in
 *  [[WorkspaceTeardownService]] (HEL-366). New top-level route prefix — no
 *  existing route collides (design.md Risks/Trade-offs). */
class WorkspaceRoutes(
    workspaceTeardownService: WorkspaceTeardownService,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("workspace") {
      path("teardown") {
        post {
          entity(as[TeardownRequest]) { req =>
            ServiceResponse.run(workspaceTeardownService.teardown(req, user))(identity)
          }
        }
      }
    }
}
