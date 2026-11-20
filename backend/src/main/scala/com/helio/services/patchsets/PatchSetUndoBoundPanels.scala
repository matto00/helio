package com.helio.services.patchsets

import com.helio.domain.model.{AuthenticatedUser, DashboardId, PanelId, PipelineId, PipelineStepId}
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

  /** Ids of every panel `edit`'s undo would delete (including panels the set created). */
  private def doomed(edit: JournaledEdit, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Vector[String]] = {
    def byOutputs(outputIds: Set[String]): Future[Vector[String]] =
      ctx.panelRepo.findIdsByOutputIdsInternal(outputIds.toVector).map(_.values.flatten.toVector)
    edit.newId match {
      case None => Future.successful(Vector.empty)
      case Some(id) =>
        edit.targetKind match {
          case "output"   => byOutputs(Set(id))
          case "pipeline" => ctx.outputRepo.listByPipelineInternal(PipelineId(id)).flatMap(os => byOutputs(os.map(_.id.value).toSet))
          case "dashboard" => ctx.dashboardRepo.panelIdsInternal(DashboardId(id)).map(_.map(_.value).toVector)
          case "pipelineStep" =>
            // the step delete's REAL removal set (the step and every non-promoted child subtree), not just the step
            ctx.pipelineStepRepo.removedByDeleteInternal(PipelineStepId(id)).flatMap { removed =>
              ctx.pipelineStepRepo.findByIdInternal(PipelineStepId(id)).flatMap {
                case None => Future.successful(Vector.empty[String])
                case Some(step) =>
                  ctx.outputRepo.listByPipelineInternal(step.pipelineId)
                    .flatMap(os => byOutputs(os.filter(_.node.stepId.exists(s => removed.contains(s.value))).map(_.id.value).toSet))
              }
            }
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
        val (looked, rest) = ids.splitAt(NameCap)
        Future.traverse(looked)(describe(_, user, ctx)).map { described =>
          val named      = described.flatten
          val unreadable = looked.size - named.size
          val parts = Vector(
            Some(named.mkString(", ")).filter(_.nonEmpty),
            Some(s"and ${rest.size} more").filter(_ => rest.nonEmpty),
            Some(s"and $unreadable panel(s) on dashboards you cannot see").filter(_ => unreadable > 0)
          ).flatten.mkString(", ")
          Some(
            s"edit ${edit.index} (${edit.targetKind} create): ${ids.size} panel(s) were added after the patch set was applied " +
              s"and would be deleted: $parts; remove or rebind them before undoing"
          )
        }
    }

  /** `"<title>" on dashboard "<name>"` when the undoing user can read both, else `None` (counted, never named). */
  private def describe(panelId: String, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    ctx.panelRepo.findById(PanelId(panelId), Some(user)).flatMap {
      case None => Future.successful(None)
      case Some(panel) =>
        ctx.dashboardRepo.findById(panel.dashboardId, Some(user)).map(_.map(d => s""""${panel.title}" on dashboard "${d.name}""""))
    }

  /** The fixed Phase-2 failure phrase: a count only, never a title, dashboard name or id (it is logged at ERROR). */
  def boundDuringUndo(count: Int): String = s"$count panel(s) were bound during the undo; nothing further was undone"

}
