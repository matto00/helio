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
import com.helio.services.panels.OutputControlsValidator
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

  // HEL-1189 design.md D5 — same nullable-optional `.orNull` convention `ApiRoutes.scala` uses to
  // wire `PanelService`'s own instance; reused here (rather than threading `PanelService` itself
  // into this route, a broader constructor change) so this, the app's one true panel-READ path
  // (`GET /api/dashboards/:id/panels` — see this class's own doc comment: authenticated dashboard
  // viewing and public/shared viewing both funnel through here), can compute live orphan status
  // per `output-panel-placement`'s Requirement 3 ("reported as orphaned wherever the panel's
  // controls are read") using the SAME decision `OutputControlsValidator.reject` (write-time)
  // makes — never a second, independently-maintained copy.
  private val outputControlsValidator = new OutputControlsValidator(outputRepoOpt.orNull, nodeSnapshotRepoOpt.orNull)

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

  /** HEL-1189 design.md D5 — the ids of `panel`'s controls currently orphaned (bound column
   *  absent from the Output's CURRENT declared schema, or present but no longer eligible for its
   *  kind), mirroring `resolveDataAsOf`'s own per-panel async-resolve pattern and degrade-
   *  gracefully convention. `Set.empty` for any non-`OutputPanel` kind, a panel with no controls,
   *  an unresolvable Output, or when `outputRepoOpt` is unavailable — never a failed page. */
  private def resolveOrphanedControlIds(panel: Panel): Future[Set[String]] =
    (panel, outputRepoOpt) match {
      case (op: OutputPanel, Some(outputRepo)) if op.config.controls.nonEmpty =>
        op.outputId match {
          case Some(outputId) =>
            outputRepo.findByIdInternal(outputId).flatMap {
              case None => Future.successful(Set.empty[String])
              case Some(output) =>
                Future
                  .traverse(op.config.controls) { control =>
                    outputControlsValidator.isOrphaned(output, control).map(orphaned => if (orphaned) Some(control.id) else None)
                  }
                  .map(_.flatten.toSet)
            }
          case None => Future.successful(Set.empty[String])
        }
      case _ => Future.successful(Set.empty[String])
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
   *  above.
   *
   *  HEL-590 evaluation-2.md CR-A: always called from inside the directive's authorized block, so
   *  `accessAlreadyGranted = true` is passed straight through to `findAllByDashboardId` -- see that
   *  method's own doc for why this is required (a share-token-authorized caller matches none of
   *  the repository's own owner/grantee/public-viewer-grant predicates). */
  private def resolveRows(dashboardId: String, panelId: String, page: Page): Future[Either[String, PagedResult[JsValue]]] =
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(offset = 0, limit = Page.MaxLimit), accessAlreadyGranted = true).flatMap { paged =>
      paged.items.find(_.id.value == panelId) match {
        case None => Future.successful(Left("Panel not found"))
        case Some(op: OutputPanel) =>
          (op.outputId, outputRepoOpt, nodeSnapshotRepoOpt) match {
            case (Some(outputId), Some(outputRepo), Some(nodeSnapshotRepo)) =>
              outputRepo.findByIdInternal(outputId).flatMap {
                case None => Future.successful(Right(PagedResult(Vector.empty[JsValue], 0, page.offset, page.limit)))
                case Some(output) =>
                  nodeSnapshotRepo
                    // HEL-913 R12/5.8b-iv-a: scope a root-bound read (`stepId = None`) to THIS
                    // Output's own root -- `output.node.rootId` is exactly that, already
                    // resolved at write time.
                    .listRowsPaged(output.node.pipelineId.value, output.node.stepId.map(_.value), page, explicitRootId = output.node.rootId.map(_.value))
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
            parameters(
              "offset".as[Int].withDefault(Page.Default.offset),
              "limit".as[Int].withDefault(Page.Default.limit),
              // HEL-590: `?token=<share token>` -- the share URL itself must carry the credential
              // (design.md D1); part of the published contract per the sibling spec.md.
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
              ) { _ =>
                // HEL-590 evaluation-2.md CR-A: `_` here is the directive's resolved `ResourceAccess`
                // (Owner/Editor/Viewer, however it was granted -- including via a share token, which
                // matches none of `findAllByDashboardId`'s own owner/grantee/public-grant predicates).
                // Reaching this block at all means the caller is authorized; `accessAlreadyGranted =
                // true` threads that decision through instead of letting the repository re-derive
                // (and fail to re-derive) it from `userOpt` alone.
                val resultF = panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, page, accessAlreadyGranted = true)
                  .flatMap { paged =>
                    // HEL-1189 design.md D5: `orphanedControlIds` resolved alongside `dataAsOf` per
                    // panel, same async-resolve-then-merge shape — this is the app's one true
                    // panel-READ path, so it's where Requirement 3's "reported as orphaned wherever
                    // the panel's controls are read" is actually enforced.
                    Future.sequence(paged.items.map(panel =>
                      for {
                        dataAsOf    <- resolveDataAsOf(panel)
                        orphanedIds <- resolveOrphanedControlIds(panel)
                      } yield (panel, dataAsOf, orphanedIds)
                    ))
                      .map { rows =>
                        val responses = rows.map { case (panel, dataAsOf, orphanedIds) =>
                          PanelResponse.fromDomain(panel, dataAsOf, orphanedControlIds = Some(orphanedIds))
                        }
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
