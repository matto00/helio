package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.PanelRepository
import com.helio.services.PanelService

import scala.concurrent.ExecutionContextExecutor

/** Public (unauthenticated-friendly) read access to a dashboard's panels.
 *  Sharing-aware ACL is enforced via `AclDirective.authorizeResourceWithSharing`;
 *  cross-user `typeId` bindings are resolved through
 *  [[PanelService.resolveBindingsForRead]] — the same helper PanelService.update
 *  uses, closing the CS2a "unify resolvePanels" spinoff. */
final class PublicDashboardRoutes(
    panelRepo: PanelRepository,
    panelService: PanelService,
    aclDirective: AclDirective,
    userOpt: Option[AuthenticatedUser]
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
      pathEndOrSingleSlash {
        get {
          aclDirective.authorizeResourceWithSharing(
            "dashboard",
            dashboardId,
            userOpt,
            "Dashboard not found"
          ) { _ =>
            val panelsF = panelRepo.findByDashboardId(DashboardId(dashboardId))
              .flatMap(panels => panelService.resolveBindingsForRead(panels, userOpt))
            onSuccess(panelsF) { panels =>
              complete(PanelsResponse(items = panels.map(PanelResponse.fromDomain)))
            }
          }
        }
      }
    }
}
