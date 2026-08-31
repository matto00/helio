package com.helio.api.routes.dashboards

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.api.http._
import com.helio.domain.model._
import com.helio.infrastructure.persistence.panels.PanelRepository

import scala.concurrent.ExecutionContextExecutor

/** Public (unauthenticated-friendly) read access to a dashboard's panels.
 *  Sharing-aware ACL is enforced via `AclDirective.authorizeResourceWithSharing`.
 *  HEL-904 task 4.1: the `dataTypeId`-keyed binding-resolution + `dataAsOf`
 *  lookup (`PanelService.resolveBindingsForRead` /
 *  `PipelineRepository.findLastRunAtByOutputDataTypeId`) were removed
 *  outright — no panel carries a `dataTypeId` binding anymore. */
final class PublicDashboardRoutes(
    panelRepo: PanelRepository,
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
                  .map { paged =>
                    val responses = paged.items.map(panel => PanelResponse.fromDomain(panel))
                    PagedResult(responses, paged.total, paged.offset, paged.limit)
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
