package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.PanelResponse
import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec, PipelineStepResponse, UpdatePipelineStepRequest}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import PatchSetApplyServiceJson._
import spray.json.{JsArray, JsObject, JsValue}

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Pipeline-step-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetPipelineStepResolvers {

  import PatchSetResolverSupport.{requireTargetId, authorizeEditorOrOwnerOnPipeline, requireVisibleStep, decodeCreatePatch}

  /** pipelineStep update: when the decoded config patch is a
   *  `JoinConfig`/`UnionConfig`/`LookupConfig`, the SAME "Pre-flight ACL"
   *  owner-only check `PipelineService.updateStep`/`addStep` already run,
   *  mirrored (the config branch of `PipelineStepWrites.updateStep` and
   *  `PipelineStepCreate.addStepReporting`). */
  private def validateEmbeddedStepReferences(
      existing: PipelineStep,
      request: UpdatePipelineStepRequest,
      user: AuthenticatedUser,
      index: Int,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    request.config match {
      case None => Future.successful(Right(()))
      case Some(cfgJson) =>
        // HEL-814 D0/D2 — THE defect this ticket names. `validateRawConfig`
        // has existed since HEL-860 and is wired into
        // `PipelineService.addStep`/`updateStep`, but NOT here, so preview and
        // refinement apply checked only decode Success/Failure — precisely the
        // check the ticket identifies as insufficient, because a tolerant
        // decoder turns a wrong-shape config into a plausible-looking one.
        // It runs BEFORE the decode and referential checks below so a caller
        // gets the specific "which key, what shape" message rather than the
        // generic "invalid config" one.
        //
        // Status is 422 (UnprocessableEntity), matching
        // `pipeline-step-config-rejection`'s 422 for the create/update
        // surfaces — this is the same rejection, applied at a different
        // surface, so it gets the same status. Deliberately NOT the
        // BadRequest (400) this function emits for a decode failure: that one
        // means "unparseable", this one means "understood and refused".
        PipelineStep.rawConfigProblem(existing.kind, cfgJson.compactPrint) match {
          case Some(msg) =>
            Future.successful(Left(ServiceError.UnprocessableEntity(s"edit $index: $msg")))
          case None =>
        PipelineStepConfigCodec.decode(existing.kind, cfgJson.compactPrint) match {
          case Failure(_) =>
            Future.successful(Left(ServiceError.BadRequest(s"edit $index: invalid '${existing.kind}' config")))
          case Success(typedConfig) =>
            // HEL-950: was three hand-copied arms (join and union both unconditional --
            // HEL-620's union fix never reached this file -- lookup already `.nonEmpty`-
            // guarded); now driven by the same shared extractor PipelineService.addStep/
            // updateStep use, so this surface cannot independently drift again.
            PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
              case Some(id) =>
                ctx.dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
                  case None    => Left(ServiceError.NotFound(s"edit $index: data source not found: $id"))
                  case Some(_) => Right(())
                }
              case None => Future.successful(Right(()))
            }
        }
        }
    }

  private[patchsets] def resolvePipelineStepUpdate(
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
                edit.pipelineStepPatch match {
                  case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: patch is required for a pipelineStep update")))
                  case Some(request) =>
                    validateEmbeddedStepReferences(existing, request, user, index, ctx).flatMap {
                      case Left(err) => Future.successful(Left(err))
                      case Right(_) =>
                        // HEL-913 task 7.6a-i: `priorState` (the `existing` snapshot captured
                        // BEFORE the patch applies) must carry its real root -- this is exactly
                        // what a later undo/rollback restores from, so a silently-absent rootId
                        // here would make PatchSetUndoInverse's recreate-from-priorState lose it.
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

  /** HEL-914 task 5.1/5.2/5.5 (design.md D3): a `pipelineStep` create -- a lane -- names its
   *  parent PIPELINE via `target.parentId` (required, non-blank; `target.id` is unused for a
   *  create, exactly like every other kind's `create` resolver). The step-level tree shape
   *  (which EXISTING step this lane branches off) is carried inside the `createPatch` body's
   *  own `parentStepId`, decoded as the SAME `CreatePipelineStepRequest` shape `POST
   *  /pipelines/:id/steps` accepts -- no second DTO. Authorization is the SAME owner-or-editor
   *  check every other pipelineStep resolver uses (`authorizeEditorOrOwnerOnPipeline`) -- an
   *  unwritable parent pipeline refuses the whole patch set. */
  /** HEL-914 (peer-approved fix, found during the 6b.5/7.6 title-diff sweep): `patch-set-apply`'s
   *  "Pre-validation also authorizes resources referenced inside a patch" requirement already
   *  enumerates `pipelineStep update`'s second-source (join/union/lookup `secondaryInput`) ACL
   *  check as a PRE-VALIDATION-time authorization -- this ticket's own new `pipelineStep create`
   *  op is now covered the same way, reusing the SAME decode+extract+ownership-check shape
   *  `resolvePipelineStepUpdate` already runs, never a second, independently-drifting copy
   *  (mirrors `PipelineStepConfigCodec.secondaryDataSourceId`'s own "one shared extractor" intent,
   *  HEL-950). Without this, the ACL check still fires (later, at forward-apply time inside
   *  `PipelineService.addStep`, atomically rolled back on failure) -- not a security hole, but an
   *  inconsistency in WHEN the check runs relative to what this requirement discloses. */
  private[patchsets] def resolvePipelineStepCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    edit.target.parentId.map(_.trim).filter(_.nonEmpty) match {
      case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: target.parentId is required for a pipelineStep create")))
      case Some(parentIdStr) =>
        val pipelineId = PipelineId(parentIdStr)
        authorizeEditorOrOwnerOnPipeline(pipelineId, user, ctx).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            decodeCreatePatch[CreatePipelineStepRequest](edit, index) match {
              case Left(err) => Future.successful(Left(err))
              case Right(request) =>
                // HEL-1417: the strict step-config check `addStep` applies, at resolve time (422,
                // nothing applied; preview shares this path) -- same `edit N: <msg>` shape as a
                // pipelineStep update edit. Runs after authorization and before the second-source
                // check so a caller gets the specific config message. An unknown `type` yields no
                // problem here and keeps its apply-time 400.
                PipelineStep.rawConfigProblem(request.`type`, request.config.compactPrint) match {
                  case Some(msg) =>
                    Future.successful(Left(ServiceError.UnprocessableEntity(s"edit $index: $msg")))
                  case None =>
                    authorizeSecondSourceForCreate(request, index, user, ctx).map {
                      case Left(err) => Left(err)
                      case Right(_)  => Right(ResolvedEdit(index, "pipelineStep", "create", None, ResolvedAction.PipelineStepCreate(pipelineId, request)))
                    }
                }
            }
        }
    }

  /** Pre-validation authorization for a `pipelineStep` create's second-source reference -- the
   *  SAME `PipelineStepConfigCodec.secondaryDataSourceId` extraction + `findByIdOwned` ownership
   *  check `resolvePipelineStepUpdate` runs. A `lane`-kind secondary input (naming a node in the
   *  same pipeline, not a separately-owned DataSource) never reaches this check at all --
   *  `secondaryDataSourceId` returns `None` for it, matching `addStep`'s own identical skip. */
  private def authorizeSecondSourceForCreate(
      request: CreatePipelineStepRequest,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    PipelineStepConfigCodec.decode(request.`type`, request.config.compactPrint) match {
      case Failure(_) =>
        // An undecodable config is reported by `PipelineService.addStep`'s own decode at
        // forward-apply time with the curated "Invalid '<type>' config" message -- not
        // duplicated here, since this check exists only to authorize a REFERENCE the config
        // might carry, not to validate the config's own shape.
        Future.successful(Right(()))
      case Success(typedConfig) =>
        PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
          case Some(id) =>
            ctx.dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
              case None    => Left(ServiceError.NotFound(s"edit $index: data source not found: $id"))
              case Some(_) => Right(())
            }
          case None => Future.successful(Right(()))
        }
    }
}
