package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
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
          parameters("offset".as[Int].withDefault(Page.Default.offset), "limit".as[Int].withDefault(Page.Default.limit)) { (offsetRaw, limitRaw) =>
            if (offsetRaw < 0)
              complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
            else {
              val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found"
              ) { _ =>
                val resultF = panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, page)
                  .flatMap { paged =>
                    panelService.resolveBindingsForRead(paged.items, userOpt)
                      .map(resolved => PagedResult(resolved.map(PanelResponse.fromDomain), paged.total, paged.offset, paged.limit))
                  }
                onSuccess(resultF) { result =>
                  complete(result)
                }
              }
            }
          }
        }
      }
    }
}
