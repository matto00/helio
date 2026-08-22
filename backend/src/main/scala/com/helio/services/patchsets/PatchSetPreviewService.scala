package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.api.protocols.patchsets.{EditPreview, PatchSet, PatchSetPreviewResponse}
import com.helio.domain.model.AuthenticatedUser
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository

import scala.concurrent.{ExecutionContext, Future}

/** Read-only diff/impact preview for a `PatchSet` (HEL-408) -- the mutation
 *  analogue of `DashboardProposalService.validate`. Computes each edit's
 *  before/after diff + impact hints WITHOUT writing anything.
 *
 *  Reuses HEL-406's `PatchSetApplyResolvers.resolveAll` for target/ACL/shape
 *  pre-validation VERBATIM (design.md D1, same `PatchSetApplyContext`
 *  construction `PatchSetApplyService.apply` builds) -- a pre-validation
 *  failure returns the SAME `Left(ServiceError)` `apply` would return, for
 *  the identical reason. On success, every `ResolvedEdit` is projected via
 *  `PatchSetPreviewProjection` (design.md D2/D3/D1a) -- the FIRST `Left`
 *  among all edits fails the WHOLE `preview` call, matching a `resolveAll`
 *  failure's shape exactly (not a partial/per-edit-only failure).
 *
 *  No repository writes anywhere in this file -- `PatchSetPreviewProjection`/
 *  `PatchSetPreviewImpact` perform reads only (design.md D1a's content
 *  checks, D4's impact-hint detection). */
final class PatchSetPreviewService(
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    metricRepo: MetricRepository,
    accessChecker: AccessChecker
)(implicit ec: ExecutionContext) {

  private val context: PatchSetApplyContext =
    PatchSetApplyContext(panelRepo, dashboardRepo, dataSourceRepo, dataTypeRepo, pipelineRepo, pipelineStepRepo, metricRepo, accessChecker)

  def preview(patchSet: PatchSet, user: AuthenticatedUser): Future[Either[ServiceError, PatchSetPreviewResponse]] =
    PatchSetApplyResolvers.resolveAll(patchSet.edits, user, context).flatMap {
      case Left(err)       => Future.successful(Left(err))
      case Right(resolved) => previewResolved(resolved, user)
    }

  /** Projects every resolved edit in order, short-circuiting the walk on the
   *  first `Left` -- mirrors `PatchSetApplyService.applyResolved`'s
   *  short-circuit shape, but with no rollback to perform (nothing was ever
   *  written). */
  private def previewResolved(
      resolved: Vector[ResolvedEdit],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PatchSetPreviewResponse]] = {
    def loop(remaining: Vector[ResolvedEdit], acc: Vector[EditPreview]): Future[Either[ServiceError, Vector[EditPreview]]] =
      remaining.headOption match {
        case None => Future.successful(Right(acc))
        case Some(edit) =>
          PatchSetPreviewProjection.project(edit, user, context).flatMap {
            case Left(err)      => Future.successful(Left(err))
            case Right(preview) => loop(remaining.tail, acc :+ preview)
          }
      }
    loop(resolved, Vector.empty).map(_.map(PatchSetPreviewResponse.apply))
  }
}
