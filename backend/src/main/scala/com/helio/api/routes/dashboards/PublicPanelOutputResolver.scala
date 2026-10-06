package com.helio.api.routes.dashboards

import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1291: the panel-belongs-to-dashboard -> bound-Output resolution shared by every public
 *  panel-scoped route (`rows` has its own degrade-to-empty variant). Split out of
 *  `PublicDashboardRoutes`, which keeps the directive tree and every ACL call. */
final class PublicPanelOutputResolver(
    panelRepo: PanelRepository,
    userOpt: Option[AuthenticatedUser],
    outputRepo: OutputRepository
)(implicit executionContext: ExecutionContext) {

  /** HEL-1190 design.md D5/D8 (tasks 2.1/2.2/2.4) — resolves `dashboardId + panelId ->
   *  (OutputPanel, Output)` server-side, shared by the three new panel-scoped public routes below
   *  (`filter-capabilities`/`distinct-values`/`output-meta`) so none of them ever accepts a
   *  caller-supplied `outputId` (C11). Reuses `resolveRows`'s SAME `findAllByDashboardId` lookup --
   *  the panel is proven to actually belong to THIS dashboard before anything about its bound
   *  Output is resolved. Deliberately `ServiceError.NotFound` for every "can't resolve" case
   *  (missing panel, wrong kind, no bound Output, or unresolvable Output) -- unlike `resolveRows`'s degrade-gracefully-to-empty-page contract, these
   *  three routes have no "page" to degrade to, so a 404 is the correct, existence-not-leaked
   *  response (the caller already passed the dashboard-level ACL gate to reach here). */
  def resolvePanelOutput(dashboardId: String, panelId: String): Future[Either[ServiceError, (OutputPanel, Output)]] =
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(offset = 0, limit = Page.MaxLimit), accessAlreadyGranted = true).flatMap { paged =>
      paged.items.find(_.id.value == panelId) match {
        case Some(op: OutputPanel) =>
          op.outputId match {
            case Some(outputId) =>
              outputRepo.findByIdInternal(outputId).map {
                case Some(output) => Right((op, output))
                case None         => Left(ServiceError.NotFound("Output not found"))
              }
            case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
          }
        case _ => Future.successful(Left(ServiceError.NotFound("Panel not found")))
      }
    }
}
