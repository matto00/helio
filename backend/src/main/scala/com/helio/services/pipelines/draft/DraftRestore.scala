package com.helio.services.pipelines.draft

import com.helio.api.protocols.patchsets.{EditUndoOutcome, PatchSetUndoResponse}
import com.helio.api.protocols.pipelines.{DraftOutputRequest, DraftSaveRequest, DraftStepRequest}
import com.helio.domain.model.{AuthenticatedUser, PipelineId}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledEdit
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
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
final class DraftRestore(save: DraftSaveService, outputRepo: OutputRepository, panelRepo: PanelRepository)(implicit ec: ExecutionContext) {

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
                dependentsOfRemovedOutputs(pipelineId, prior).zip(dependentsOfCreatedOutputs(pipelineId, prior)).map { case (a, b) => a ++ b }.flatMap {
                  case blockers if blockers.nonEmpty =>
                    Future.successful(Left(ServiceError.Conflict(
                      s"Undo refused: it would remove or has removed ${blockers.mkString(", ")}, which undo cannot recreate or delete; nothing was changed."
                    )))
                  case _ =>
                    save.saveCore(pipelineId, request, user, DraftSaveMode.Restore).map(_.map { saved =>
                      PatchSetUndoResponse(Vector(EditUndoOutcome(edit.index, "restored", None, Some(JsObject("fingerprint" -> JsString(saved.fingerprint))))))
                    })
                }
            }
        }
      case _ => Future.successful(Left(ServiceError.Conflict(s"edit ${edit.index}: the journal is missing its captured pipeline definition")))
    }

  /** The panels and alert rules the journaled prior state recorded on an Output the save removed (an Output of the prior
   *  state that is no longer present), named. */
  private def dependentsOfRemovedOutputs(pipelineId: PipelineId, prior: JsObject): Future[Vector[String]] =
    outputRepo.listByPipelineInternal(pipelineId).map { current =>
      val present = current.map(_.id.value).toSet
      prior.fields.get("definition").map(_.asJsObject).flatMap(_.fields.get("outputs")).collect { case JsArray(os) => os }.getOrElse(Vector.empty)
        .map(_.asJsObject).filterNot(o => present.contains(o.fields("id").convertTo[String]))
        .flatMap { o =>
          val outputId = o.fields("id").convertTo[String]
          o.fields.get("panelIds").collect { case JsArray(ps) => ps.map(p => s"panel ${p.convertTo[String]} (Output $outputId)") }.getOrElse(Vector.empty) ++
            o.fields.get("alertRules").collect { case JsArray(rs) =>
              rs.map { r => val ro = r.asJsObject; s"alert rule ${ro.fields("id").convertTo[String]} \"${ro.fields("name").convertTo[String]}\" (Output $outputId)" }
            }.getOrElse(Vector.empty)
        }
    }

  /** The panels and alert rules now bound to an Output the save CREATED (a current Output the journaled prior state does not
   *  have): undoing would delete it and so them. Refused here, naming each; the transaction re-checks the same thing under
   *  its locks (a panel bound after this read forces a fresh refusal there, never a silent delete). */
  private def dependentsOfCreatedOutputs(pipelineId: PipelineId, prior: JsObject): Future[Vector[String]] = {
    val priorIds = prior.fields.get("outputs").collect { case JsArray(os) => os.map(_.asJsObject.fields("id").convertTo[String]).toSet }.getOrElse(Set.empty[String])
    outputRepo.listByPipelineInternal(pipelineId).flatMap { current =>
      val created = current.map(_.id.value).filterNot(priorIds.contains)
      if (created.isEmpty) Future.successful(Vector.empty)
      else
        for {
          panels <- panelRepo.findIdsByOutputIdsInternal(created)
          rules  <- outputRepo.findAlertRuleDefinitionsInternal(created)
        } yield
          panels.toVector.flatMap { case (output, ids) => ids.map(id => s"panel $id (Output $output)") } ++
            rules.toVector.flatMap { case (output, rs) => rs.map(r => s"alert rule ${r._1} \"${r._4}\" (Output $output)") }
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
      DraftSaveRequest(baseFingerprint, steps, outputs, runAfterSave = None, confirmCascade = None)
    }.toEither.left.map(_ => "the journaled pipeline definition could not be read")
}
