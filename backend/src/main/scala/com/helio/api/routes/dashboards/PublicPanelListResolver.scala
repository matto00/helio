package com.helio.api.routes.dashboards

import com.helio.api._
import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import com.helio.services.panels.OutputControlsValidator

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1291: the public panel-list assembly (dataAsOf, orphaned control ids, owner-view rule).
 *  Split out of `PublicDashboardRoutes`, which keeps the directive tree and every ACL call. */
final class PublicPanelListResolver(
    panelRepo: PanelRepository,
    userOpt: Option[AuthenticatedUser],
    outputRepo: OutputRepository,
    pipelineRepoOpt: Option[PipelineRepository],
    nodeSnapshotRepoOpt: Option[NodeSnapshotRepository]
)(implicit executionContext: ExecutionContext) {

  // HEL-1189 design.md D5 — same convention `ApiRoutes.scala` uses to wire `PanelService`'s own
  // instance (`outputRepo` required, `nodeSnapshotRepo` nullable); reused here (rather than
  // threading `PanelService` itself into this route, a broader constructor change) so this, the
  // app's one true panel-READ path (`GET /api/dashboards/:id/panels` — see `PublicDashboardRoutes`'s own doc
  // comment: authenticated dashboard viewing and public/shared viewing both funnel through here), can compute live orphan status
  // per `output-panel-placement`'s Requirement 3 ("reported as orphaned wherever the panel's
  // controls are read") using the SAME decision `OutputControlsValidator.reject` (write-time)
  // makes — never a second, independently-maintained copy.
  private val outputControlsValidator = new OutputControlsValidator(outputRepo, nodeSnapshotRepoOpt.orNull)

  /** `None` for any panel kind other than `OutputPanel`, or when the pipeline repo is unavailable
   *  (mirrors this codebase's existing `Option[Repository]`-degrades-gracefully convention), or
   *  when the Output/pipeline can no longer be resolved. */
  private def resolveDataAsOf(panel: Panel): Future[Option[String]] =
    (panel, pipelineRepoOpt) match {
      case (op: OutputPanel, Some(pipelineRepo)) =>
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
   *  or an unresolvable Output — never a failed page. */
  private def resolveOrphanedControlIds(panel: Panel): Future[Set[String]] =
    panel match {
      case op: OutputPanel if op.config.controls.nonEmpty =>
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

  /** The panel-list route's `resultF` body: `findAllByDashboardId -> per-panel resolve ->
   *  PanelResponse.fromDomain`, incl. the `ownerView` rule. Moved verbatim from the route's
   *  authorized block (HEL-1291); `access` is that block's resolved `ResourceAccess`. */
  def panelList(dashboardId: String, page: Page, access: ResourceAccess): Future[PagedResult[PanelResponse]] =
    // HEL-590 evaluation-2.md CR-A: `access` here is the directive's resolved `ResourceAccess`
    // (Owner/Editor/Viewer, however it was granted -- including via a share token, which
    // matches none of `findAllByDashboardId`'s own owner/grantee/public-grant predicates).
    // Reaching this block at all means the caller is authorized; `accessAlreadyGranted =
    // true` threads that decision through instead of letting the repository re-derive
    // (and fail to re-derive) it from `userOpt` alone.
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, page, accessAlreadyGranted = true)
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
              // HEL-1197/HEL-1216: `ownerId` and `meta.createdBy` (the creator's id) go only
              // to the dashboard's owner or that panel's own creator -- never to an
              // anonymous, share-token-only, or authenticated non-owner grantee/stranger.
              val ownerView = access == ResourceAccess.Owner || userOpt.exists(_.id.value == panel.ownerId.value)
              PanelResponse.fromDomain(panel, dataAsOf, orphanedControlIds = Some(orphanedIds), includeOwnerId = ownerView)
            }
            PagedResult(responses, paged.total, paged.offset, paged.limit)
          }
      }
}
