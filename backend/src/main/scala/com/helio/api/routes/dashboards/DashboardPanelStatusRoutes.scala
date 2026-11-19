package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.api.http.AclDirective
import com.helio.api.protocols.dashboards.DashboardPanelStatusResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.dashboards.DashboardPanelStatusService
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

/** `GET /api/dashboards/:id/panel-status` (HEL-1786), in the authenticated `/api` tree (session or PAT; no share token). The
 *  dashboard ACL (`authorizeResourceWithSharing`, the directive every per-panel route uses) admits the owner and any editor or
 *  viewer grantee and answers a stranger or an unknown id with the same `404`; access is re-checked on every request. */
final class DashboardPanelStatusRoutes(
    service: DashboardPanelStatusService,
    aclDirective: AclDirective,
    user: AuthenticatedUser
) extends JsonProtocols {

  val routes: Route =
    path("dashboards" / Segment / "panel-status") { dashboardId =>
      get {
        aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, Some(user), "Dashboard not found") { _ =>
          onSuccess(service.status(dashboardId, user))(status => complete(DashboardPanelStatusResponse.fromDomain(status)))
        }
      }
    }
}
