package com.helio.api.routes.dashboards

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.api.http._
import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import spray.json.JsValue

import scala.concurrent.{ExecutionContextExecutor, Future}

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
    outputRepoOpt: Option[OutputRepository] = None,
    pipelineRepoOpt: Option[PipelineRepository] = None,
    nodeSnapshotRepoOpt: Option[NodeSnapshotRepository] = None
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  /** `None` for any panel kind other than `OutputPanel`, or when either repo is unavailable
   *  (mirrors this codebase's existing `Option[Repository]`-degrades-gracefully convention, e.g.
   *  `outputRepoOpt` in `ApiRoutes.scala`), or when the Output/pipeline can no longer be
   *  resolved. */
  private def resolveDataAsOf(panel: Panel): Future[Option[String]] =
    (panel, outputRepoOpt, pipelineRepoOpt) match {
      case (op: OutputPanel, Some(outputRepo), Some(pipelineRepo)) =>
        op.outputId match {
          case Some(outputId) =>
            outputRepo.findByIdInternal(outputId).flatMap {
              case Some(output) =>
                pipelineRepo.findByIdInternal(output.node.pipelineId).map(_.flatMap(_.lastRunAt).map(_.toString))
              case None => Future.successful(None)
            }
          case None => Future.successful(None)
        }
      case _ => Future.successful(None)
    }

  /** HEL-910 task 1.1: `GET /dashboards/:dashboardId/panels/:panelId/rows`. Resolves
   *  `panelId -> outputId -> node_snapshot` for the public/optional-auth path. Reuses
   *  `panelRepo.findAllByDashboardId` (the same lookup the panel-list route above already
   *  uses) rather than `PanelRepository.findByIdInternal`, so the panel is proven to actually
   *  belong to THIS dashboard before its rows are read -- the dashboard-level
   *  `authorizeResourceWithSharing` gate below is only a valid authority for panels that are
   *  really on the dashboard it was checked against. A panel of a non-`OutputPanel` kind, a
   *  panel with no bound `outputId`, or an unresolvable Output/snapshot degrades to an empty
   *  page rather than a 500 -- mirrors `resolveDataAsOf`'s own degrade-gracefully convention
   *  above. */
  private def resolveRows(dashboardId: String, panelId: String, page: Page): Future[Either[String, PagedResult[JsValue]]] =
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(offset = 0, limit = Page.MaxLimit)).flatMap { paged =>
      paged.items.find(_.id.value == panelId) match {
        case None => Future.successful(Left("Panel not found"))
        case Some(op: OutputPanel) =>
          (op.outputId, outputRepoOpt, nodeSnapshotRepoOpt) match {
            case (Some(outputId), Some(outputRepo), Some(nodeSnapshotRepo)) =>
              outputRepo.findByIdInternal(outputId).flatMap {
                case None => Future.successful(Right(PagedResult(Vector.empty[JsValue], 0, page.offset, page.limit)))
                case Some(output) =>
                  nodeSnapshotRepo
                    .listRowsPaged(output.node.pipelineId.value, output.node.stepId.map(_.value), page)
                    .map(paged => Right(paged.copy(items = paged.items.map(identity[JsValue]))))
              }
            case _ => Future.successful(Right(PagedResult(Vector.empty[JsValue], 0, page.offset, page.limit)))
          }
        case Some(_) => Future.successful(Right(PagedResult(Vector.empty[JsValue], 0, page.offset, page.limit)))
      }
    }

  val routes: Route =
    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
      pathPrefix(Segment / "rows") { panelId =>
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
                  onSuccess(resolveRows(dashboardId, panelId, page)) {
                    case Left(err)     => complete(StatusCodes.NotFound, ErrorResponse(err))
                    case Right(result) => complete(result)
                  }
                }
              }
            }
          }
        }
      } ~
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
                    Future.sequence(paged.items.map(panel => resolveDataAsOf(panel).map(panel -> _)))
                      .map { withDataAsOf =>
                        val responses = withDataAsOf.map { case (panel, dataAsOf) => PanelResponse.fromDomain(panel, dataAsOf) }
                        PagedResult(responses, paged.total, paged.offset, paged.limit)
                      }
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
