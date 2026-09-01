package com.helio.services.patchsets

import com.helio.domain.model.{AuthenticatedUser, Page}

import scala.concurrent.{ExecutionContext, Future}

/** Impact-hint rules for a resolved edit (design.md D4, tasks.md 2.3) -- a
 *  small, explicit, source-grounded rule set, NOT an open-ended inference
 *  engine. One rule per (kind, op), each backed by a real, already-confirmed
 *  cascade/staleness fact. Every hint here is a READ (never a write), and
 *  this object is only ever reached for an edit `PatchSetPreviewProjection`
 *  did NOT already reject. HEL-904 task 3.3: the `dataType`-delete hint is
 *  REMOVED outright -- `dataType` is no longer a valid target.kind. */
private[services] object PatchSetPreviewImpact {

  private val StaleRowsHint =
    "Pipeline output rows will be stale until re-run."

  private val PipelineDeleteCascadeHint =
    "Cascades to this pipeline's steps and run history."

  private val DataSourceDeleteCascadeHint =
    "Cascades to any pipeline built on this source."

  private def dashboardDeleteHint(panelCount: Int): String =
    s"Cascades to $panelCount panel(s)."

  def compute(
      edit: ResolvedEdit,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Vector[String]] =
    edit.action match {
      // `pipeline`/`pipelineStep` update/delete: output rows are written
      // once at run time -- no edit here triggers an automatic re-run.
      case ResolvedAction.PipelineUpdate(_, _, _) =>
        Future.successful(Vector(StaleRowsHint))
      case ResolvedAction.PipelineDelete(_, _) =>
        Future.successful(Vector(StaleRowsHint, PipelineDeleteCascadeHint))
      case ResolvedAction.PipelineStepUpdate(_, _, _) =>
        Future.successful(Vector(StaleRowsHint))
      case ResolvedAction.PipelineStepDelete(_, _) =>
        Future.successful(Vector(StaleRowsHint))

      case ResolvedAction.DataSourceDelete(_, _) =>
        Future.successful(Vector(DataSourceDeleteCascadeHint))

      // HEL-904 task 3.3: the `dataType`-delete hint (`DataTypeDelete`) is
      // REMOVED outright -- `PatchSetProtocol.recognizedKinds` no longer
      // accepts "dataType" as a valid target.kind.

      // `page.limit = 1` still returns the accurate total via the SAME
      // query's own COUNT alongside the slice -- no over-fetch.
      case ResolvedAction.DashboardDelete(id, _) =>
        ctx.panelRepo.findAllByDashboardId(id, Some(user), Page(0, 1)).map { page =>
          Vector(dashboardDeleteHint(page.total))
        }

      // HEL-904 task 4.1: the panel-update "rebind to a different DataType"
      // hint is REMOVED outright -- no panel carries a `dataTypeId` binding
      // anymore.

      // Every other (kind, op): an ordinary rename/content edit has no
      // cascade/staleness consequence beyond the diff itself.
      case _ => Future.successful(Vector.empty)
    }
}
