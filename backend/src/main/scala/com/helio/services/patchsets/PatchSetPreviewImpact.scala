package com.helio.services.patchsets

import com.helio.domain.model.{AuthenticatedUser, Page, PanelId, PipelineId}

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
      ctx: PatchSetApplyContext,
      overlay: PatchSetPreviewOverlay = PatchSetPreviewOverlay.empty
  )(implicit ec: ExecutionContext): Future[Vector[String]] =
    edit.action match {
      // `pipeline`/`pipelineStep` update/delete: output rows are written
      // once at run time -- no edit here triggers an automatic re-run.
      case ResolvedAction.PipelineUpdate(_, _, _) =>
        Future.successful(Vector(StaleRowsHint))
      case ResolvedAction.PipelineDelete(id, _) =>
        removedBoundHints(id, user, ctx, overlay).map(Vector(StaleRowsHint, PipelineDeleteCascadeHint) ++ _)
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
          // The count at resolve time, adjusted for panels earlier edits of the set created or deleted there.
          Vector(dashboardDeleteHint(overlay.panelCount(id.value, page.total)))
        }

      // HEL-904 task 4.1: the panel-update "rebind to a different DataType"
      // hint is REMOVED outright -- no panel carries a `dataTypeId` binding
      // anymore.

      // HEL-1239: `output` update/delete deliberately carry no hint (decision recorded in the
      // audit table) -- a cascade-to-panels hint would need a panel lookup this preview does not
      // otherwise make; listed explicitly so the omission is a decision, not a wildcard accident.
      case ResolvedAction.OutputUpdate(_, _, _, _) | ResolvedAction.OutputDelete(_, _) =>
        Future.successful(Vector.empty)

      // Every other (kind, op): an ordinary rename/content edit has no
      // cascade/staleness consequence beyond the diff itself.
      case _ => Future.successful(Vector.empty)
    }

  private val NameCap = 5

  /** HEL-1522: what a pipeline delete removes through its Outputs -- the bound panels and targeting alert rules.
   *  Names come only from caller-scoped reads (a panel via `findById(.., Some(user))`, a rule via the caller's visible
   *  ids); anything the caller cannot read is counted, never named. Panels an earlier edit of the set already deletes
   *  are skipped, and a panel renamed earlier shows its new title. Known gaps (not handled): a panel created, rebound
   *  onto or away from one of the Outputs by an earlier edit of the same set is not tracked per Output. */
  private def removedBoundHints(id: PipelineId, user: AuthenticatedUser, ctx: PatchSetApplyContext, overlay: PatchSetPreviewOverlay)(
      implicit ec: ExecutionContext
  ): Future[Vector[String]] =
    for {
      outputs    <- ctx.outputRepo.listByPipelineInternal(id)
      outputIds   = outputs.map(_.id.value)
      panelIds   <- ctx.panelRepo.findIdsByOutputIdsInternal(outputIds)
      alertRules <- ctx.outputRepo.findAlertRuleDefinitionsInternal(outputIds)
      livePanels  = panelIds.values.flatten.toVector.distinct.sorted.filterNot(overlay.isRemoved("panel", _))
      titles     <- Future.traverse(livePanels)(pid => ctx.panelRepo.findById(PanelId(pid), Some(user)).map(_.map(p => overlay.panel(p).title)))
      rules       = alertRules.values.flatten.toVector.distinctBy(_._1).sortBy(_._1)
      visible    <- ctx.outputRepo.findVisibleAlertRuleIds(rules.map(_._1), user)
    } yield {
      val panelNames = titles.flatten
      val ruleNames  = rules.collect { case (rid, _, _, name, _, _) if visible(rid) => name }
      namingHint("panel(s)", livePanels.size, panelNames) ++ namingHint("alert rule(s)", rules.size, ruleNames)
    }

  private def namingHint(noun: String, total: Int, names: Vector[String]): Vector[String] =
    if (total == 0) Vector.empty
    else {
      val shown     = names.take(NameCap).map(n => "\"" + n + "\"")
      val more      = names.size - shown.size
      val invisible = total - names.size
      val listed    = (if (shown.nonEmpty) ": " + shown.mkString(", ") else "") +
        (if (more > 0) s" and $more more" else "") +
        (if (invisible > 0) (if (shown.nonEmpty || more > 0) "; " else ": ") + s"$invisible you cannot see" else "")
      Vector(s"Removes $total $noun$listed.")
    }
}
