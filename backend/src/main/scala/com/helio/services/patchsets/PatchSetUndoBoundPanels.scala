package com.helio.services.patchsets

import com.helio.domain.model.{AuthenticatedUser, DashboardId, Output, PanelId, PipelineId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledEdit

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1720: the one shared "panels bound since the apply" check behind the `output`, `pipelineStep`, `pipeline` and
 *  `dashboard` create arms of undo. Deleting any of those resources deletes the panels bound to or placed on it (FK
 *  cascades, which ignore RLS), including panels the patch set did not create and panels another user owns; undo refuses
 *  rather than delete them.
 *
 *  Doomed panels are read through internal (ACL-bypassing) reads, because the check must see other users' panels.
 *  Excused panels are the ones the same application's reverse walk removes BEFORE the resource is deleted: every `panel`
 *  `create` edit's `newId`. A `panel` `update` edit is deliberately NOT excused (design D2 point 2b): the doomed resource
 *  is created by this very set, so no earlier-existing panel can be bound to it by an update (only a panel create may name
 *  a `$ref`), and blocking is the safe direction. */
private[services] object PatchSetUndoBoundPanels {

  /** At most this many blocking panels are looked up and named; the rest are only counted. */
  val NameCap = 10

  /** The create-arm kinds this check guards. */
  def guards(edit: JournaledEdit): Boolean =
    edit.op == "create" && Set("output", "pipelineStep", "pipeline", "dashboard").contains(edit.targetKind)

  /** The panels `edit`'s undo would delete that the patch set did not create (sorted, distinct). */
  def blockingPanelIds(edit: JournaledEdit, edits: Vector[JournaledEdit], ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Vector[String]] =
    doomed(edit, ctx).map { doomedPanels =>
      val created = edits.filter(e => e.targetKind == "panel" && e.op == "create").flatMap(_.newId).toSet
      (doomedPanels.toSet -- created).toVector.sorted
    }

  /** HEL-1795: the Outputs and pipeline steps a `pipeline` / `pipelineStep` create edit's undo deletes (read through
   *  internal reads), computed once and shared by the panel check and the later-Outputs/steps check so the two never
   *  drift. `steps` excludes the created step itself on the `pipelineStep` arm. Empty for every other arm. */
  final case class DoomedRows(outputs: Vector[Output], steps: Vector[PipelineStep])

  private val NoRows = DoomedRows(Vector.empty, Vector.empty)

  def doomedRows(edit: JournaledEdit, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[DoomedRows] =
    (edit.targetKind, edit.newId) match {
      case ("pipeline", Some(id)) =>
        for {
          outputs <- ctx.outputRepo.listByPipelineInternal(PipelineId(id))
          steps   <- ctx.pipelineStepRepo.listByPipelineInternal(PipelineId(id))
        } yield DoomedRows(outputs, steps)
      case ("pipelineStep", Some(id)) =>
        // the step delete's REAL removal set (the step and every non-promoted child subtree), not just the step
        ctx.pipelineStepRepo.removedByDeleteInternal(PipelineStepId(id)).flatMap { removed =>
          ctx.pipelineStepRepo.findByIdInternal(PipelineStepId(id)).flatMap {
            case None => Future.successful(NoRows)
            case Some(step) =>
              for {
                os    <- ctx.outputRepo.listByPipelineInternal(step.pipelineId)
                steps <- ctx.pipelineStepRepo.listByPipelineInternal(step.pipelineId)
              } yield DoomedRows(
                os.filter(_.node.stepId.exists(sid => removed.contains(sid.value))),
                steps.filter(st => st.id.value != id && removed.contains(st.id.value))
              )
          }
        }
      case _ => Future.successful(NoRows)
    }

  /** HEL-1811: the Outputs `edit`'s undo would delete, for the three arms that delete Outputs: the created Output itself
   *  (`output`), or every Output of the pipeline / of the created step's removal set ([[doomedRows]]). One computation for
   *  the panel check and the alert-rule check, so the sets never drift. Empty for every other arm. */
  def doomedOutputIds(edit: JournaledEdit, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Vector[String]] =
    (edit.targetKind, edit.newId) match {
      case ("output", Some(id))                        => Future.successful(Vector(id))
      case ("pipeline" | "pipelineStep", Some(_))       => doomedRows(edit, ctx).map(_.outputs.map(_.id.value))
      case _                                            => Future.successful(Vector.empty)
    }

  /** The alert-rule row shape `OutputRepository.findAlertRuleDefinitionsInternal` returns: `(id, metric, condition, name,
   *  enabled, severity)`. */
  type AlertRuleRow = (String, String, String, String, Boolean, String)

  /** HEL-1811: the alert-rule clause shared by the draft-save undo's refusal and the patch-set undo's: a rule is named
   *  (`alert rule "<name>"`) only when `user` owns it ([[OutputRepository.findVisibleAlertRuleIds]]) and the rest are
   *  counted (`N alert rule(s) you do not own`); no id appears. Deliberately NOT capped like [[nameList]]: the draft-save
   *  undo has always named every owned rule and its text must stay byte-identical, so do not "fix" it to `NameCap`. */
  def alertRuleClause(rules: Vector[AlertRuleRow], user: AuthenticatedUser, outputRepo: OutputRepository)(implicit
      ec: ExecutionContext
  ): Future[Option[String]] = {
    val ruleRows = rules.sortBy(_._1)
    outputRepo.findVisibleAlertRuleIds(ruleRows.map(_._1), user).map { visible =>
      val (named, unowned) = ruleRows.partition(r => visible.contains(r._1))
      val ruleNames        = named.map(r => s"""alert rule "${r._4}"""")
      Some(
        (ruleNames ++ Some(s"${unowned.size} alert rule(s) you do not own").filter(_ => unowned.nonEmpty).map(c => if (ruleNames.nonEmpty) s"and $c" else c)).mkString(", ")
      ).filter(_.nonEmpty)
    }
  }

  /** Ids of every panel `edit`'s undo would delete (including panels the set created). */
  private def doomed(edit: JournaledEdit, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Vector[String]] = {
    def byOutputs(outputIds: Set[String]): Future[Vector[String]] =
      ctx.panelRepo.findIdsByOutputIdsInternal(outputIds.toVector).map(_.values.flatten.toVector)
    edit.newId match {
      case None => Future.successful(Vector.empty)
      case Some(id) =>
        edit.targetKind match {
          case "dashboard" => ctx.dashboardRepo.panelIdsInternal(DashboardId(id)).map(_.map(_.value).toVector)
          case "output" | "pipeline" | "pipelineStep" => doomedOutputIds(edit, ctx).flatMap(ids => byOutputs(ids.toSet))
          case _ => Future.successful(Vector.empty)
        }
    }
  }

  /** The Phase-1 blocker for `edit`, or `None` when nothing blocks. Names readable panels, counts the rest. */
  def blocker(edit: JournaledEdit, edits: Vector[JournaledEdit], user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Option[String]] =
    blockingPanelIds(edit, edits, ctx).flatMap {
      case ids if ids.isEmpty => Future.successful(None)
      case ids =>
        describeBlocking(ids, user, ctx.panelRepo, ctx.dashboardRepo).map { parts =>
          Some(
            s"edit ${edit.index} (${edit.targetKind} create): ${ids.size} panel(s) were added after the patch set was applied " +
              s"and would be deleted: $parts; remove or rebind them before undoing"
          )
        }
    }

  /** HEL-1792: the shared naming half of a refusal. Names (up to [[NameCap]]) the panels `user` can read as
   *  `"<title>" on dashboard "<name>"`, counts the overflow, and counts the ones `user` cannot read, never naming them. Also
   *  used by the draft-save undo's refusal. */
  def describeBlocking(ids: Vector[String], user: AuthenticatedUser, panelRepo: PanelRepository, dashboardRepo: DashboardRepository)(implicit
      ec: ExecutionContext
  ): Future[String] =
    nameList(ids, describe(_, user, panelRepo, dashboardRepo), s"panel(s) on dashboards you cannot see")

  /** The shared naming structure (HEL-1792, reused by HEL-1795): describes up to [[NameCap]] of `ids` with `describeOne`
   *  (`None` = the user cannot read it), then counts the overflow and the unreadable ones with `unreadableNoun`, never
   *  naming them. */
  def nameList(ids: Vector[String], describeOne: String => Future[Option[String]], unreadableNoun: String)(implicit
      ec: ExecutionContext
  ): Future[String] = {
    val (looked, rest) = ids.splitAt(NameCap)
    Future.traverse(looked)(describeOne).map { described =>
      val named      = described.flatten
      val unreadable = looked.size - named.size
      Vector(
        Some(named.mkString(", ")).filter(_.nonEmpty),
        Some(s"and ${rest.size} more").filter(_ => rest.nonEmpty),
        Some(s"and $unreadable $unreadableNoun").filter(_ => unreadable > 0)
      ).flatten.mkString(", ")
    }
  }

  /** `"<title>" on dashboard "<name>"` when the undoing user can read both, else `None` (counted, never named). */
  private def describe(panelId: String, user: AuthenticatedUser, panelRepo: PanelRepository, dashboardRepo: DashboardRepository)(implicit
      ec: ExecutionContext
  ): Future[Option[String]] =
    panelRepo.findById(PanelId(panelId), Some(user)).flatMap {
      case None => Future.successful(None)
      case Some(panel) =>
        dashboardRepo.findById(panel.dashboardId, Some(user)).map(_.map(d => s""""${panel.title}" on dashboard "${d.name}""""))
    }

  /** The fixed Phase-2 failure phrase: a count only, never a title, dashboard name or id (it is logged at ERROR). */
  def boundDuringUndo(count: Int): String = s"$count panel(s) were bound during the undo; nothing further was undone"

}
