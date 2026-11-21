package com.helio.services.pipelines.draft

import com.helio.api.protocols.patchsets.{EditUndoOutcome, PatchSetUndoResponse}
import com.helio.api.protocols.pipelines.{DraftOutputRequest, DraftRootRequest, DraftSaveRequest, DraftStepRequest}
import com.helio.domain.model.{AuthenticatedUser, PipelineId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledEdit
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.patchsets.PatchSetUndoBoundPanels
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Undo of a draft save (HEL-1629, design D7; owner ruling 2026-10-16 `refuse-dependent-restore-rest`): the journaled prior
 *  definition is re-applied through the SAME transaction as the save, with the post-save fingerprint as `baseFingerprint`, so
 *  it is atomic (reorder included) and refuses to undo over later edits (409 `PATCH_SET_STALE`).
 *
 *  Deleted steps and Outputs that had no bound panels or alert rules come back under their ORIGINAL ids. If the save's
 *  cascade removed a panel or an alert rule, the undo is refused with a 409 naming each one and nothing changes: undo
 *  recreates definitions only. Cascade-deleted run history, node snapshots and payloads are data and are not restored. A
 *  run that rewrote a `NewSource` upsert step changes the fingerprint, so such a save can no longer be undone. */
final class DraftRestore(save: DraftSaveService, outputRepo: OutputRepository, panelRepo: PanelRepository, dashboardRepo: DashboardRepository)(implicit ec: ExecutionContext) {

  def restore(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[ServiceError, PatchSetUndoResponse]] =
    (edit.priorState.map(_.asJsObject), edit.resultingState.map(_.asJsObject)) match {
      case (Some(prior), Some(resulting)) =>
        (for {
          pipelineId  <- str(prior, "pipelineId")
          baseFp      <- str(resulting, "fingerprint")
          request     <- requestOf(prior, baseFp)
        } yield (PipelineId(pipelineId), baseFp, request)) match {
          case Left(msg) => Future.successful(Left(ServiceError.Conflict(msg)))
          case Right((pipelineId, _, request)) =>
            save.editable(pipelineId, user).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                dependentsOfRemovedOutputs(pipelineId, prior).zip(dependentsOfCreatedOutputs(pipelineId, prior, user)).flatMap {
                  case (removed, created) if removed.isDefined || created.isDefined =>
                    // one `Undo refused:` prefix and one `nothing was changed.` suffix, whichever refusals apply
                    val body = Vector(removed, created).flatten.mkString("; ")
                    Future.successful(Left(ServiceError.Conflict(s"Undo refused: $body; nothing was changed.")))
                  case _ =>
                    save.saveCore(pipelineId, request, user, DraftSaveMode.Restore).map(_.map { saved =>
                      PatchSetUndoResponse(Vector(EditUndoOutcome(edit.index, "restored", None, Some(JsObject("fingerprint" -> JsString(saved.fingerprint))))))
                    })
                }
            }
        }
      case _ => Future.successful(Left(ServiceError.Conflict(s"edit ${edit.index}: the journal is missing its captured pipeline definition")))
    }

  /** The count-only clause for panels and alert rules the journaled prior state recorded on an Output the save removed (an
   *  Output of the prior state that is no longer present). The save's cascade deleted them, so there is nothing left to name
   *  and the journal holds only ids (and rule names that may belong to other users): counts only. */
  private def dependentsOfRemovedOutputs(pipelineId: PipelineId, prior: JsObject): Future[Option[String]] =
    outputRepo.listByPipelineInternal(pipelineId).map { current =>
      val present = current.map(_.id.value).toSet
      val removed = prior.fields.get("definition").map(_.asJsObject).flatMap(_.fields.get("outputs")).collect { case JsArray(os) => os }.getOrElse(Vector.empty)
        .map(_.asJsObject).filterNot(o => present.contains(o.fields("id").convertTo[String]))
      def count(key: String): Int = removed.map(_.fields.get(key).collect { case JsArray(xs) => xs.size }.getOrElse(0)).sum
      val parts = Vector(
        Some(s"${count("panelIds")} panel(s)").filter(_ => count("panelIds") > 0),
        Some(s"${count("alertRules")} alert rule(s)").filter(_ => count("alertRules") > 0)
      ).flatten
      if (parts.isEmpty) None else Some(s"the save removed ${parts.mkString(" and ")} with its Outputs, and undo cannot recreate them")
    }

  /** The panels and alert rules now bound to an Output the save CREATED (a current Output the journaled prior state does not
   *  have): undoing would delete it and so them. Refused here; panels the undoing user can read are named by title and
   *  dashboard, the rest counted ([[PatchSetUndoBoundPanels.describeBlocking]]), an alert rule is named only if the user owns it
   *  and counted otherwise, and no id appears. The transaction re-checks under its locks (count-only), though the fingerprint
   *  covers every Output's panels so a later bind is a stale base first. */
  private def dependentsOfCreatedOutputs(pipelineId: PipelineId, prior: JsObject, user: AuthenticatedUser): Future[Option[String]] = {
    val priorIds = prior.fields.get("outputs").collect { case JsArray(os) => os.map(_.asJsObject.fields("id").convertTo[String]).toSet }.getOrElse(Set.empty[String])
    outputRepo.listByPipelineInternal(pipelineId).flatMap { current =>
      val created = current.map(_.id.value).filterNot(priorIds.contains)
      if (created.isEmpty) Future.successful(None)
      else
        for {
          panels  <- panelRepo.findIdsByOutputIdsInternal(created)
          rules   <- outputRepo.findAlertRuleDefinitionsInternal(created)
          panelIds = panels.values.flatten.toVector.distinct.sorted
          ruleRows = rules.values.flatten.toVector.sortBy(_._1)
          visible <- outputRepo.findVisibleAlertRuleIds(ruleRows.map(_._1), user)
          described <- if (panelIds.isEmpty) Future.successful("") else PatchSetUndoBoundPanels.describeBlocking(panelIds, user, panelRepo, dashboardRepo)
        } yield {
          val (named, unowned) = ruleRows.partition(r => visible.contains(r._1))
          val panelClause = Some(s"${panelIds.size} panel(s) (${described.stripPrefix("and ")})").filter(_ => panelIds.nonEmpty)
          val ruleNames   = named.map(r => s"""alert rule "${r._4}"""")
          val ruleClause = Some(
            (ruleNames ++ Some(s"${unowned.size} alert rule(s) you do not own").filter(_ => unowned.nonEmpty).map(c => if (ruleNames.nonEmpty) s"and $c" else c)).mkString(", ")
          ).filter(_.nonEmpty)
          val clauses = Vector(panelClause, ruleClause).flatten
          if (clauses.isEmpty) None
          else Some(s"this save created Outputs that now have dependents undo would delete: ${clauses.mkString("; ")}; remove or rebind them before undoing")
        }
    }
  }

  private def str(obj: JsObject, key: String): Either[String, String] =
    obj.fields.get(key).collect { case JsString(v) => v }.toRight(s"the journal is missing '$key'")

  private def optStr(v: JsValue, key: String): Option[String] = v.asJsObject.fields.get(key).collect { case JsString(s) => s }

  private def requestOf(prior: JsObject, baseFingerprint: String): Either[String, DraftSaveRequest] =
    Try {
      val steps = prior.fields("steps").convertTo[Vector[JsValue]].map { s =>
        val o = s.asJsObject
        DraftStepRequest(
          id = optStr(s, "id"), clientId = None, `type` = o.fields("type").convertTo[String], config = o.fields("config").asJsObject,
          enabled = Some(o.fields("enabled").convertTo[Boolean]), parentStepId = optStr(s, "parentStepId"), parentClientId = None,
          rootId = optStr(s, "rootId"), position = o.fields("position").convertTo[Int]
        )
      }
      val outputs = prior.fields("outputs").convertTo[Vector[JsValue]].map { out =>
        DraftOutputRequest(
          id = optStr(out, "id"), clientId = None, name = out.asJsObject.fields("name").convertTo[String],
          kind = out.asJsObject.fields("kind").convertTo[String], nodeStepId = optStr(out, "nodeStepId"), nodeStepClientId = None,
          rootId = optStr(out, "rootId"), config = Some(out.asJsObject.fields("config").asJsObject)
        )
      }
      // HEL-1734: rows journaled before roots could change carry no `rootDefs`; their saves never touched roots, so `roots`
      // stays absent. Otherwise the roots come back in their original order under their original ids and sources.
      val roots = prior.fields.get("rootDefs").collect { case JsArray(defs) =>
        defs.map(_.asJsObject).sortBy(_.fields("position").convertTo[Int]).map { d =>
          DraftRootRequest(id = optStr(d, "id"), clientId = None, sourceId = optStr(d, "dataSourceId"))
        }
      }
      DraftSaveRequest(baseFingerprint, steps, outputs, runAfterSave = None, confirmCascade = None, roots = roots)
    }.toEither.left.map(_ => "the journaled pipeline definition could not be read")
}
