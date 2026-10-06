package com.helio.api.routes.dashboards

import com.helio.api.protocols.pipelines.{OutputSchemaFieldResponse, ProvenanceResponses, PublicOutputMetaResponse, PublicOutputProvenanceResponse}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.pipelines.ProvenanceService
import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1291: the public Output-metadata surfaces (`output-meta`, `provenance`). Split out of
 *  `PublicDashboardRoutes`, which keeps the directive tree and every ACL call. */
final class PublicPanelOutputMetaResolver(
    outputRepo: OutputRepository,
    provenanceServiceOpt: Option[ProvenanceService],
    panelOutput: PublicPanelOutputResolver
)(implicit executionContext: ExecutionContext) {

  /** HEL-1190 design.md D8 (task 2.4) — `kind`/`config`/`schema` only (HEL-1197 dropped `ownerId`), never row data;
   *  the ONE new metadata source `usePublicPanelData` needs to pick/configure a renderer, since
   *  `PanelResponse.config` (the panel-list route) is only the PANEL's own placement config,
   *  never the bound Output's. `config` needs its own repository call (`Output` itself carries no
   *  `config` field -- see `OutputRepository`'s own doc comment) — reuses the SAME
   *  `findConfigsByIdsInternal` batch method `OutputService`'s own authenticated callers use,
   *  singleton-Vector'd for this one Output. */
  def resolveOutputMeta(dashboardId: String, panelId: String): Future[Either[ServiceError, PublicOutputMetaResponse]] =
    panelOutput.resolvePanelOutput(dashboardId, panelId).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((_, output)) =>
        outputRepo.findConfigsByIdsInternal(Vector(output.id.value)).map { configs =>
          Right(
            PublicOutputMetaResponse(
              kind = OutputKind.asString(output.kind),
              config = configs.getOrElse(output.id.value, JsObject.empty),
              schema = output.schema.flatMap(sf => DataFieldType.fromString(sf.`type`).map(t => OutputSchemaFieldResponse(sf.name, DataFieldType.asString(t))))
            )
          )
        }
    }

  /** HEL-1206 design.md D7 -- public provenance: same `resolvePanelOutput` gate (panel proven to
   *  belong to THIS dashboard, OutputPanel with a bound Output; every failure `404`) as
   *  `output-meta`; the chain is then built by `ProvenanceService` (`*Internal` reads, cleared by
   *  the dashboard gate in the route) and projected through the allowlist-only public type. */
  def resolveProvenance(dashboardId: String, panelId: String): Future[Either[ServiceError, PublicOutputProvenanceResponse]] =
    panelOutput.resolvePanelOutput(dashboardId, panelId).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((_, output)) =>
        provenanceServiceOpt match {
          case None      => Future.successful(Left(ServiceError.NotFound("Output not found")))
          case Some(svc) => svc.forOutput(output).map(chain => Right(ProvenanceResponses.public(chain)))
        }
    }
}
