package com.helio.api.routes.dashboards

import com.helio.api.protocols.pipelines.{OutputHistoryResponses, PublicOutputHistoryResponse}
import com.helio.api.routes.pipelines.OutputHistoryQueryParsing
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.pipelines.OutputHistoryService
import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1291: the public history surface (D8 summary-only projection via
 *  `OutputHistoryResponses.public`). Split out of `PublicDashboardRoutes`, which keeps the
 *  directive tree and every ACL call. */
final class PublicPanelHistoryResolver(
    outputRepo: OutputRepository,
    historyServiceOpt: Option[OutputHistoryService],
    panelOutput: PublicPanelOutputResolver
)(implicit executionContext: ExecutionContext) {

  /** HEL-1273: public history -- same `resolvePanelOutput` gate as `output-meta`/`provenance`
   *  (every failure `404`), projected through the allowlist-only public type. The Output's config is
   *  read with the same `*Internal` batch lookup `output-meta` uses. */
  def resolveHistory(
      dashboardId: String,
      panelId: String,
      q: OutputHistoryQueryParsing.Query
  ): Future[Either[ServiceError, PublicOutputHistoryResponse]] =
    historyServiceOpt match {
      case Some(svc) =>
        panelOutput.resolvePanelOutput(dashboardId, panelId).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right((_, output)) =>
            outputRepo.findConfigsByIdsInternal(Vector(output.id.value)).flatMap { configs =>
              svc.forOutput(output, configs.getOrElse(output.id.value, JsObject.empty), q.limit, q.since)
                .map(r => Right(OutputHistoryResponses.public(r)))
            }
        }
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
    }
}
