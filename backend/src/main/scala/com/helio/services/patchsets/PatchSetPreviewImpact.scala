package com.helio.services.patchsets

import com.helio.services.panels.PanelServiceHelpers
import com.helio.domain.model.{AuthenticatedUser, Page}

import scala.concurrent.{ExecutionContext, Future}

/** Impact-hint rules for a resolved edit (design.md D4, tasks.md 2.3) -- a
 *  small, explicit, source-grounded rule set, NOT an open-ended inference
 *  engine. One rule per (kind, op), each backed by a real, already-confirmed
 *  cascade/staleness fact. Every hint here is a READ (never a write), and
 *  this object is only ever reached for an edit `PatchSetPreviewProjection`
 *  did NOT already reject (design.md D4's dataType-delete hint is ONLY
 *  computed when the owned-panel content check already returned `false`). */
private[services] object PatchSetPreviewImpact {

  private val StaleRowsHint =
    "Pipeline output rows will be stale until re-run."

  private val PipelineDeleteCascadeHint =
    "Cascades to this pipeline's steps and run history."

  private val DataSourceDeleteCascadeHint =
    "Cascades to any pipeline built on this source."

  /** design.md D4: the app-level owned-panel check (already run by
   *  `PatchSetPreviewProjection.dataTypeDeleteAfter`) cannot see cross-owner
   *  bindings -- this is the one case `apply` does not reject, so preview
   *  surfaces it as a hint instead. */
  private val DataTypeDeleteUnbindHint =
    "Panels shared by other users may be unbound (panels.type_id ON DELETE SET NULL, " +
      "V5__panel_type_binding.sql:1) — not visible to this preview's ownership-scoped check."

  private val RebindHint =
    "Panel will be bound to a different DataType."

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

      // design.md D4's detection mechanism (round-2 REFUTE fix):
      // `existsBoundToType` is RLS-scoped, never privileged -- see that
      // method's own doc for why (no cross-tenant existence leak).
      case ResolvedAction.DataTypeDelete(id, _) =>
        ctx.panelRepo.existsBoundToType(id, user).map {
          case true  => Vector(DataTypeDeleteUnbindHint)
          case false => Vector.empty
        }

      // `page.limit = 1` still returns the accurate total via the SAME
      // query's own COUNT alongside the slice -- no over-fetch.
      case ResolvedAction.DashboardDelete(id, _) =>
        ctx.panelRepo.findAllByDashboardId(id, Some(user), Page(0, 1)).map { page =>
          Vector(dashboardDeleteHint(page.total))
        }

      case ResolvedAction.PanelUpdate(_, request, prior) =>
        val rebinds = request.config
          .flatMap(PanelServiceHelpers.dataTypeIdFromConfigPatch)
          .exists(newId => !prior.dataTypeId.contains(newId))
        Future.successful(if (rebinds) Vector(RebindHint) else Vector.empty)

      // Every other (kind, op): an ordinary rename/content edit has no
      // cascade/staleness consequence beyond the diff itself.
      case _ => Future.successful(Vector.empty)
    }
}
