package com.helio.services.patchsets

import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind}
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.{JournaledCreatedDataset, JournaledEdit}
import com.helio.infrastructure.persistence.sources.DataSourceReferenceRepository.SourceReferences
import spray.json.{JsValue, JsonParser}

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** HEL-1796: undoing a `dataSource` create deletes the source, and `dataset_rows` cascades on it (V106), so every row
 *  added, replaced or edited since the apply, and every schema edit, would be lost without a word. This is the shared
 *  predicate for both phases: Phase 1 refuses (409, nothing restored) and Phase 2 re-checks right before the delete.
 *
 *  Detection compares timestamps, never `seq` (append reuses `seq` after a delete; replace and schema migration
 *  renumber). With a journaled [[com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledCreatedDataset]]
 *  the threshold is the stored `created_at` the create stamped on the source and its rows (a deleted row blocks
 *  nothing). A journal row without one falls back to `appliedAt` and also treats any change of `data_sources.updated_at`
 *  as work (a lone row delete then refuses: an accepted over-refusal, as a refusal changes nothing).
 *
 *  Only counts and the HEL-1792 name list for references ever reach a message: no row value or id, no pipeline, panel,
 *  dashboard or source id, no other user's name. */
private[services] object PatchSetUndoDatasetLaterWork {

  final case class Found(appended: Int, edited: Int, schemaEdited: Boolean, changedSinceApply: Boolean) {
    def isEmpty: Boolean = appended == 0 && edited == 0 && !schemaEdited && !changedSinceApply
  }

  /** What changed on the source `edit` created since the apply; empty when the source no longer exists. */
  def blocking(edit: JournaledEdit, appliedAt: Instant, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Found] =
    edit.newId match {
      case None     => Future.successful(Found(0, 0, schemaEdited = false, changedSinceApply = false))
      case Some(id) => blockingSource(id, edit.createdDataset, appliedAt, ctx)
    }

  /** The shared predicate: what changed on source `id` since `journaled`'s stamp (or `appliedAt` without one). */
  def blockingSource(id: String, journaledDataset: Option[JournaledCreatedDataset], appliedAt: Instant, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Found] = {
    val journaled = journaledDataset.flatMap(d => d.rowsStampedAt.map(t => (t, d.declaredSchema)))
    val threshold = journaled.map(_._1).getOrElse(appliedAt)
    ctx.dataSourceRepo.datasetLaterWork(DataSourceId(id), threshold).map {
      case None => Found(0, 0, schemaEdited = false, changedSinceApply = false)
      case Some(w) =>
        journaled match {
          case Some((_, declared)) =>
            val live = w.schemaText.flatMap(t => Try(JsonParser(t): JsValue).toOption)
            Found(w.appended, w.edited, schemaEdited = declared.isDefined && live != declared, changedSinceApply = false)
          case None =>
            Found(w.appended, w.edited, schemaEdited = false, changedSinceApply = w.sourceUpdatedAt.isAfter(appliedAt))
        }
    }
  }

  /** HEL-1796 fold-in (D9): the inline dataset root sources of a `pipeline` `create` edit that undo would delete with later
   *  work: journaled, still existing, live kind `dataset`, and referenced by nothing but the pipeline being undone (a
   *  source with any other reference, hidden ones included, is kept by HEL-1493 and never blocks). Pairs each with its
   *  name (the applying user owns it) and what changed. */
  def inlineFindings(edit: JournaledEdit, appliedAt: Instant, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Vector[(String, Found)]] =
    Future.traverse(edit.inlineSources.getOrElse(Vector.empty)) { source =>
      ctx.dataSourceRepo.findByIdOwned(DataSourceId(source.id), user).flatMap {
        case Some(live) if live.kind == DataSourceKind.Dataset =>
          ctx.dataSourceRepo.findReferences(DataSourceId(source.id), user).flatMap { refs =>
            val referenced = refs.pipelines.exists(p => !edit.newId.contains(p.id)) || refs.panels.nonEmpty ||
              refs.hiddenPipelineCount > 0 || refs.hiddenPanelCount > 0
            if (referenced) Future.successful(None)
            else blockingSource(source.id, source.createdDataset, appliedAt, ctx).map(f => Some((live.name, f)).filterNot(_._2.isEmpty))
          }
        case _ => Future.successful(None)
      }
    }.map(_.flatten)

  /** The Phase-1 blockers for a `pipeline` create's inline dataset roots, one per source with later work. */
  def inlineBlockers(edit: JournaledEdit, appliedAt: Instant, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Vector[String]] =
    inlineFindings(edit, appliedAt, user, ctx).map(_.flatMap { case (name, found) =>
      workMessages(s"""edit ${edit.index} (pipeline create): its inline data source "$name"""", found)
    })

  /** The fixed Phase-2 failure phrase for inline roots: a count only (it is logged at ERROR). */
  def inlineChangedDuringUndo(count: Int): String =
    s"$count inline data source(s) gained later work during the undo; nothing further was undone"

  private def workMessages(head: String, found: Found): Vector[String] =
    if (found.schemaEdited)
      Vector(s"$head: the dataset schema was edited after the patch set was applied, which rewrote its rows; undoing would delete them")
    else
      Vector(
        Some(found.appended).filter(_ > 0).map(n => s"$head: $n row(s) were added or replaced after the patch set was applied and would be deleted"),
        Some(found.edited).filter(_ > 0).map(n => s"$head: $n row(s) created by the patch set were edited after it was applied and the edits would be lost"),
        Some(found.changedSinceApply).filter(identity).map(_ => s"$head: the data source was changed after the patch set was applied")
      ).flatten

  /** The Phase-1 blockers for `edit` (one string per kind that blocks), or empty. */
  def blockers(edit: JournaledEdit, appliedAt: Instant, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Vector[String]] = {
    val head = s"edit ${edit.index} (dataSource create)"
    val refs = edit.newId match {
      case None     => Future.successful(None)
      case Some(id) => ctx.dataSourceRepo.findReferences(DataSourceId(id), user).map(r => Some(r).filterNot(_.isEmpty))
    }
    for {
      found <- blocking(edit, appliedAt, ctx)
      used  <- refs.flatMap(_.fold(Future.successful(Option.empty[String]))(referenceParts(_).map(Option(_))))
    } yield {
      val rows = workMessages(head, found)
      rows ++ used.map(parts => s"$head: the data source is now used by $parts; remove those uses before undoing")
    }
  }

  /** `pipeline "<name>"` and `"<title>" on dashboard "<name>"` for the ones the undoing user can read (up to the HEL-1792
   *  cap, the rest counted), then the ones they cannot see as counts. Never an id. */
  private def referenceParts(refs: SourceReferences)(implicit ec: ExecutionContext): Future[String] = {
    val named: Map[String, String] =
      refs.pipelines.map(p => p.id -> s"""pipeline "${p.name}"""").toMap ++
        refs.panels.map(p => p.id -> s""""${p.title}" on dashboard "${p.dashboardName}"""").toMap
    val ids = refs.pipelines.map(_.id) ++ refs.panels.map(_.id)
    PatchSetUndoBoundPanels.nameList(ids, id => Future.successful(named.get(id)), "resource(s) you cannot see").map { shown =>
      Vector(
        Some(shown).filter(_.nonEmpty),
        Some(refs.hiddenPipelineCount).filter(_ > 0).map(n => s"$n pipeline(s) you cannot see"),
        Some(refs.hiddenPanelCount).filter(_ > 0).map(n => s"$n panel(s) you cannot see")
      ).flatten.mkString(", ")
    }
  }

  /** The fixed Phase-2 failure phrase: counts only, never a value, name or id (it is logged at ERROR). */
  def changedDuringUndo(found: Found): String = {
    val what = Vector(
      Some(found.appended).filter(_ > 0).map(n => s"$n row(s) were added"),
      Some(found.edited).filter(_ > 0).map(n => s"$n row(s) were edited"),
      Some(found.schemaEdited).filter(identity).map(_ => "the dataset schema was edited"),
      Some(found.changedSinceApply).filter(identity).map(_ => "the data source was changed")
    ).flatten.mkString(", ")
    s"$what during the undo; nothing further was undone"
  }

  /** The fixed phrase for a use that landed after the re-check, caught by the delete's own reference guard (its
   *  `describe` text carries ids and is never shown or logged). */
  val gainedUseDuringUndo: String = "the data source gained a use during the undo; nothing further was undone"
}
