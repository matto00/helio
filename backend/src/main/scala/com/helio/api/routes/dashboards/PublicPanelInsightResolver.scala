package com.helio.api.routes.dashboards

import com.helio.api.protocols.pipelines.{OutputInsightResponses, PublicOutputInsightResponse}
import com.helio.services.ServiceError
import com.helio.services.insights.OutputInsightReadService

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1742: the public insight surface. `PublicDashboardRoutes` keeps the directive tree and the
 *  dashboard ACL; this resolves panel -> Output (every failure `404`), requires an `insight` Output
 *  (any other kind is `404`) and projects through the allow-list-only public type. An insight Output
 *  with no `ok` render yet is `200 {render: null}`. */
final class PublicPanelInsightResolver(
    insightReadServiceOpt: Option[OutputInsightReadService],
    panelOutput: PublicPanelOutputResolver
)(implicit executionContext: ExecutionContext) {

  def resolveInsight(dashboardId: String, panelId: String): Future[Either[ServiceError, PublicOutputInsightResponse]] =
    insightReadServiceOpt match {
      case Some(svc) =>
        panelOutput.resolvePanelOutput(dashboardId, panelId).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right((_, output)) =>
            svc.latestOkFor(output).map {
              case None         => Left(ServiceError.NotFound("Output not found"))
              case Some(record) => Right(OutputInsightResponses.public(record))
            }
        }
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
    }
}
