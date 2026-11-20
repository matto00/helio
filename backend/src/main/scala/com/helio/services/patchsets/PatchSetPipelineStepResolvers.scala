package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.pipelines.GraphChecks
import com.helio.api.protocols.panels.PanelResponse
import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepResponse}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import PatchSetApplyServiceJson._
import spray.json.{JsArray, JsObject, JsValue}

import scala.concurrent.{ExecutionContext, Future}

/** Pipeline-step-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetPipelineStepResolvers {

  import PatchSetResolverSupport.{requireTargetId, requireVisibleStep, decodeCreatePatch, prefixedWithEdit}

  /** pipelineStep update: `PipelineService.updateStep`'s own pre-write checks ([[com.helio.services.pipelines.PipelineStepWriteChecks.checkUpdate]]:
   *  step visibility, editor access, type change, raw config, decode, secondary ownership, lane, upsert target), worded as the service
   *  words them behind `edit N: `. HEL-1722 D7: when an earlier edit of the set changed this step's pipeline graph the lane check is
   *  left to forward apply (`touched`). The write-back cycle guard and `position` stay inside the repository write. */
  private[patchsets] def resolvePipelineStepUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext,
      touched: Set[String]
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val stepId = PipelineStepId(idStr)
        edit.pipelineStepPatch match {
          case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: patch is required for a pipelineStep update")))
          case Some(request) =>
            // ACL: this ACL-bypassing lookup only keys the D7 graph-check skip (which pipeline an earlier edit touched). It returns nothing to the
            // caller; visibility masking and the editor check happen in `checkUpdate`, whose own lookup repeats this one.
            ctx.pipelineStepRepo.findByIdInternal(stepId).flatMap { found =>
              val graph = if (found.exists(s => touched.contains(s.pipelineId.value))) GraphChecks.Skip else GraphChecks.Run
              ctx.stepWriteChecks.checkUpdate(stepId, request, user, graph).flatMap {
                case Left(err) => Future.successful(Left(prefixedWithEdit(index, err)))
                case Right(checked) =>
                  val existing = checked.existing
                  // HEL-913 task 7.6a-i: `priorState` (the `existing` snapshot captured BEFORE the patch applies) must carry its real root --
                  // this is exactly what a later undo/rollback restores from, so a silently-absent rootId here would make
                  // PatchSetUndoInverse's recreate-from-priorState lose it.
                  ctx.pipelineStepRepo.rootIdOfStep(existing.pipelineId, existing.id).map { rootIdOpt =>
                    Right(ResolvedEdit(
                      index, "pipelineStep", "update",
                      Some(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(
                        existing, rootIdOpt.map(rid => existing.id.value -> rid.value).toMap
                      ))),
                      ResolvedAction.PipelineStepUpdate(stepId, request, existing)
                    ))
                  }
              }
            }
        }
    }

  private[patchsets] def resolvePipelineStepDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val stepId = PipelineStepId(idStr)
        ctx.pipelineStepRepo.findByIdInternal(stepId).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: pipeline step not found")))
          case Some(existing) =>
            requireVisibleStep(existing.pipelineId, index, user, ctx).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                // HEL-913 task 7.6a-i: same `priorState`-must-carry-its-real-root rationale as
                // the update resolver above -- a delete's `priorState` is what a later undo
                // recreates from. HEL-914 task 5.8: ALSO captures every Output bound to this
                // node, and each of those Outputs' placements -- the patch-set-lane-edits
                // scenario "Removing a lane by patch set and undoing it restores its Outputs
                // and placements" needs this captured at RESOLVE time (before the delete),
                // since the DB's own ON DELETE CASCADE (V94) has already destroyed them by the
                // time undo runs.
                ctx.pipelineStepRepo.rootIdOfStep(existing.pipelineId, existing.id).flatMap { rootIdOpt =>
                  buildPipelineStepDeletePriorState(existing, rootIdOpt, ctx).map { priorJson =>
                    Right(ResolvedEdit(
                      index, "pipelineStep", "delete",
                      Some(priorJson),
                      ResolvedAction.PipelineStepDelete(stepId, existing)
                    ))
                  }
                }
            }
        }
    }

  /** HEL-914 task 5.8: `{"step": <PipelineStepResponse>, "boundOutputs": [{"output":
   *  <OutputResponse>, "placements": [<PanelResponse>, ...]}, ...]}` -- everything
   *  `PatchSetUndoService.restorePipelineStepDelete`'s undo needs to recreate the step AND every
   *  Output bound to it AND every one of those Outputs' panel placements. HEL-1239: a null
   *  `ctx.outputRepo` NO LONGER silently degrades to `boundOutputs: []` (that under-reported the
   *  prior state a later undo restores from, and made preview disagree with apply) --
   *  `resolvePipelineStepDelete` rejects it with a typed ServiceError before reaching here. */
  private def buildPipelineStepDeletePriorState(
      existing: PipelineStep,
      rootIdOpt: Option[PipelineRootId],
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[JsValue] = {
    val stepJson = pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(
      existing, rootIdOpt.map(rid => existing.id.value -> rid.value).toMap
    ))
    ctx.outputRepo.listByPipelineInternal(existing.pipelineId).flatMap { allOutputs =>
      val bound = allOutputs.filter(_.node.stepId.contains(existing.id))
      if (bound.isEmpty) Future.successful(JsObject("step" -> stepJson, "boundOutputs" -> JsArray()))
      else
        ctx.outputRepo.findConfigsByIdsInternal(bound.map(_.id.value)).flatMap { configs =>
          Future.traverse(bound) { o =>
            ctx.panelRepo.findByOutputIdInternal(o.id.value).map { panels =>
              JsObject(
                "output"     -> outputResponseFormat.write(outputResponseFrom(o, configs.getOrElse(o.id.value, JsObject.empty))),
                "placements" -> JsArray(panels.map(p => panelResponseFormat.write(PanelResponse.fromDomain(p))))
              )
            }
          }.map(boundJsons => JsObject("step" -> stepJson, "boundOutputs" -> JsArray(boundJsons)))
        }
      }
  }

  /** HEL-914 task 5.1/5.2/5.5 (design.md D3): a `pipelineStep` create -- a lane -- names its parent PIPELINE via `target.parentId`
   *  (required, non-blank; `target.id` is unused for a create, exactly like every other kind's `create` resolver). The step-level tree
   *  shape (which EXISTING step this lane branches off) is carried inside the `createPatch` body's own `parentStepId`, decoded as the
   *  SAME `CreatePipelineStepRequest` shape `POST /pipelines/:id/steps` accepts -- no second DTO.
   *
   *  HEL-1722: after the patch decodes, `PipelineService.addStep`'s own pre-write checks run
   *  ([[com.helio.services.pipelines.PipelineStepWriteChecks.checkAdd]]: type, raw config, decode, editor access, secondary ownership, lane,
   *  upsert target, placement, `rejectIfReparents`), worded as the service words them behind `edit N: `. When an earlier edit of the set
   *  changed this pipeline's step graph the graph-dependent checks are left to forward apply (design D7, `touched`). */
  private[patchsets] def resolvePipelineStepCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext,
      touched: Set[String]
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    edit.target.parentId.map(_.trim).filter(_.nonEmpty) match {
      case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: target.parentId is required for a pipelineStep create")))
      case Some(parentIdStr) =>
        val pipelineId = PipelineId(parentIdStr)
        decodeCreatePatch[CreatePipelineStepRequest](edit, index) match {
          case Left(err) => Future.successful(Left(err))
          case Right(request) =>
            val graph = if (touched.contains(pipelineId.value)) GraphChecks.Skip else GraphChecks.Run
            ctx.stepWriteChecks.checkAdd(pipelineId, request, user, graph).map {
              case Left(err) => Left(prefixedWithEdit(index, err))
              case Right(_)  => Right(ResolvedEdit(index, "pipelineStep", "create", None, ResolvedAction.PipelineStepCreate(pipelineId, request)))
            }
        }
    }
}
