package com.helio.api.routes.dashboards

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.api.http._
import com.helio.api.routes.ServiceResponse
import com.helio.api.routes.pipelines.{OutputHistoryQueryParsing, OutputRowsQueryParsing}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import com.helio.services.pipelines.{OutputHistoryService, ProvenanceService}

import scala.concurrent.ExecutionContextExecutor

/** Public (unauthenticated-friendly) read access to a dashboard's panels.
 *  Sharing-aware ACL is enforced via `AclDirective.authorizeResourceWithSharing`.
 *
 *  HEL-904 task 4.1 removed the OLD `dataTypeId`-keyed binding-resolution + `dataAsOf` lookup
 *  (`PanelService.resolveBindingsForRead` / the retired `findLastRunAtByOutputDataTypeId`)
 *  outright, since no panel carries a `dataTypeId` binding anymore — but that also dropped the
 *  `dataAsOf` FEATURE itself (every response fell back to `None`), not just its old plumbing.
 *
 *  HEL-906 cycle 6 (evaluation-5.md CR6): rewires `dataAsOf` back onto the NEW `panel → output →
 *  pipeline.lastRunAt` path — the only panel kind with a direct output binding today is
 *  `OutputPanel` (`config.outputId`); every other panel kind has no output binding at all and
 *  keeps `dataAsOf = None`, exactly as it does today. `outputRepo`/`pipelineRepo` are both
 *  already unauthenticated-safe `*Internal` lookups (no ACL check needed here — the ACL gate for
 *  this whole route is the dashboard-level `authorizeResourceWithSharing` above; an Output's
 *  `lastRunAt` is not itself sensitive once its OWNING dashboard is already known to be visible
 *  to this caller). A missing/unresolvable Output or pipeline (deleted between the panel read and
 *  this lookup, or a pipeline with no successful run yet) degrades to `dataAsOf = None` rather
 *  than failing the whole page. */
final class PublicDashboardRoutes(
    panelRepo: PanelRepository,
    aclDirective: AclDirective,
    userOpt: Option[AuthenticatedUser],
    outputRepo: OutputRepository,
    pipelineRepoOpt: Option[PipelineRepository] = None,
    nodeSnapshotRepoOpt: Option[NodeSnapshotRepository] = None,
    provenanceServiceOpt: Option[ProvenanceService] = None,
    historyServiceOpt: Option[OutputHistoryService] = None
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  // HEL-1291: per-concern resolvers (same package). The directive tree and every
  // `authorizeResourceWithSharing` call stay below, in this file; the modules own only the
  // resolution logic. Declared before `routes` so they are initialised when it is built.
  private val panelOutput = new PublicPanelOutputResolver(panelRepo, userOpt, outputRepo)
  private val panelList = new PublicPanelListResolver(panelRepo, userOpt, outputRepo, pipelineRepoOpt, nodeSnapshotRepoOpt)
  private val rows = new PublicPanelRowsResolver(panelRepo, userOpt, outputRepo, nodeSnapshotRepoOpt, panelOutput)
  private val outputMeta = new PublicPanelOutputMetaResolver(outputRepo, provenanceServiceOpt, panelOutput)
  private val history = new PublicPanelHistoryResolver(outputRepo, historyServiceOpt, panelOutput)

  val routes: Route =
    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
      pathPrefix(Segment / "rows") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters(
              "offset".as[Int].withDefault(Page.Default.offset),
              "limit".as[Int].withDefault(Page.Default.limit),
              // HEL-1190 design.md D6 (task 1.2) — same `sort`/`filter` shape/parsing as the
              // authenticated `GET /api/outputs/:id/rows` (`OutputRowsQueryParsing`, shared
              // verbatim); `filter`'s named columns are additionally gated to this panel's own
              // configured control columns inside `resolveRows` (D5/D6, owner ruling C11).
              "sort".optional,
              "filter".optional,
              // HEL-590: `?token=<share token>` -- the share URL itself must carry the credential
              // (design.md D1); part of the published contract per the sibling spec.md.
              "token".optional
            ) { (offsetRaw, limitRaw, sortRaw, filterRaw, token) =>
              if (offsetRaw < 0)
                complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
              else
                (OutputRowsQueryParsing.parseSortParam(sortRaw), OutputRowsQueryParsing.parseFilterParam(filterRaw)) match {
                  case (Left(err), _) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                  case (_, Left(err)) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                  case (Right(sortParam), Right(filterParam)) =>
                    val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                    aclDirective.authorizeResourceWithSharing(
                      "dashboard",
                      dashboardId,
                      userOpt,
                      "Dashboard not found",
                      token
                    ) { _ =>
                      ServiceResponse.run(rows.resolveRows(dashboardId, panelId, page, sortParam, filterParam))(identity)
                    }
                }
            }
          }
        }
      } ~
      pathPrefix(Segment / "filter-capabilities") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("token".optional) { token =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(rows.resolveFilterCapabilities(dashboardId, panelId))(outputFilterCapabilitiesResponseFrom)
              }
            }
          }
        }
      } ~
      pathPrefix(Segment / "distinct-values") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("column", "token".optional) { (column, token) =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(rows.resolveDistinctValues(dashboardId, panelId, column))(values =>
                  outputDistinctValuesResponseFrom(column, values)
                )
              }
            }
          }
        }
      } ~
      pathPrefix(Segment / "output-meta") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("token".optional) { token =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(outputMeta.resolveOutputMeta(dashboardId, panelId))(identity)
              }
            }
          }
        }
      } ~
      pathPrefix(Segment / "history") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("limit".optional, "since".optional, "token".optional) { (limitRaw, sinceRaw, token) =>
              OutputHistoryQueryParsing.parse(limitRaw, sinceRaw) match {
                case Left(err) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                case Right(q) =>
                  aclDirective.authorizeResourceWithSharing(
                    "dashboard",
                    dashboardId,
                    userOpt,
                    "Dashboard not found",
                    token
                  ) { _ =>
                    ServiceResponse.run(history.resolveHistory(dashboardId, panelId, q))(identity)
                  }
              }
            }
          }
        }
      } ~
      pathPrefix(Segment / "provenance") { panelId =>
        pathEndOrSingleSlash {
          get {
            parameters("token".optional) { token =>
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { _ =>
                ServiceResponse.run(outputMeta.resolveProvenance(dashboardId, panelId))(identity)
              }
            }
          }
        }
      } ~
      pathEndOrSingleSlash {
        get {
          parameters(
            "offset".as[Int].withDefault(Page.Default.offset),
            "limit".as[Int].withDefault(Page.Default.limit),
            "token".optional
          ) { (offsetRaw, limitRaw, token) =>
            if (offsetRaw < 0)
              complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
            else {
              val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
              aclDirective.authorizeResourceWithSharing(
                "dashboard",
                dashboardId,
                userOpt,
                "Dashboard not found",
                token
              ) { access =>
                val resultF = panelList.panelList(dashboardId, page, access)
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
