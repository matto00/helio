package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.Edit
import com.helio.api.protocols.pipelines.CreateOutputRequest
import com.helio.domain.outputs.{InsightConfig, InsightReadsCheck}
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, OutputKind, PipelineId, PipelineStepId}
import com.helio.services.pipelines.{OutputConfigValidation, OutputFieldMappingCheck, OutputService, PipelineNodeSchemas}
import PatchSetApplyServiceJson._
import PatchSetResolverSupport.{authorizeEditorOrOwnerOnPipeline, decodeCreatePatch}
import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** Output-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetOutputResolvers {

  import PatchSetResolverSupport.requireTargetId

  // ── output (HEL-907 task 1.2 — no create, see PatchSetProtocol's doc) ────

  /** Owner-only, mirroring `OutputService.update`/`delete`'s own check exactly (`findById` is
   *  sharing-aware RLS -- any pipeline grantee can READ -- but only the owner may mutate; a
   *  non-owner sees 404, existence not leaked, never 403). */
  private def findOwnedOutput(
      id: OutputId,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Output]] =
    ctx.outputRepo.findById(id, user).map {
      case None                                     => Left(ServiceError.NotFound("Output not found"))
      case Some(output) if output.ownerId != user.id => Left(ServiceError.NotFound("Output not found"))
      case Some(output)                              => Right(output)
    }

  private[patchsets] def resolveOutputUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val outputId = OutputId(idStr)
        findOwnedOutput(outputId, user, ctx).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(existing) =>
            ctx.outputRepo.findConfigById(outputId, user).map {
              case None => Left(ServiceError.NotFound(s"edit $index: output not found"))
              case Some(existingConfig) =>
                edit.outputPatch match {
                  case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for an output update"))
                  case Some(request) => Right((request, existingConfig))
                }
            }.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right((request, existingConfig)) =>
                // HEL-1779 D4: apply (`OutputService.update`) refuses an insight whose `reads.outputs` names anything but another
                // non-insight Output of its pipeline; preview must say so too. `validateConfig` is already run by the projection.
                request.config.fold(Future.successful(Right(()): Either[String, Unit])) { patch =>
                  insightReadsProblem(existing.kind, Some(outputId), existing.node.pipelineId, patch, existingConfig, ctx)
                }.map {
                  case Left(msg) => Left(ServiceError.BadRequest(s"edit $index: $msg"))
                  case Right(()) =>
                    Right(ResolvedEdit(
                      index, "output", "update",
                      Some(outputResponseFormat.write(outputResponseFrom(existing, existingConfig))),
                      ResolvedAction.OutputUpdate(outputId, request, existing, existingConfig)
                    ))
                }
            }
        }
    }

  /** The stored-id half of an insight's `reads.outputs` against the pipeline's Outputs as they are NOW (the set-level pass
   *  [[rejectReadsOfDeletedOutputs]] removes the ones the same set deletes). Left carries the bare message. */
  private def insightReadsProblem(
      kind: OutputKind, insightId: Option[OutputId], pipelineId: PipelineId, written: JsObject, stored: JsObject, ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[String, Unit]] =
    if (kind != OutputKind.Insight || !written.fields.contains("reads")) Future.successful(Right(()))
    else
      // ACL: `listByPipelineInternal` bypasses RLS; the caller already proved owner (update) or owner/editor (create) on this pipeline.
      ctx.outputRepo.listByPipelineInternal(pipelineId).map { outputs =>
        InsightReadsCheck.check(kind, insightId, written, stored, outputs.map(o => o.id -> o.kind).toMap, OutputConfigValidation.isSelectableModel)
      }

  private[patchsets] def resolveOutputDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val outputId = OutputId(idStr)
        findOwnedOutput(outputId, user, ctx).map {
          case Left(err) => Left(err)
          case Right(existing) =>
            Right(ResolvedEdit(
              index, "output", "delete",
              // HEL-946: config is deliberately omitted here, not defaulted by
              // a silent overload — this resolved-state snapshot is for a
              // delete, so the Output's config is about to cease to exist and
              // isn't needed by any consumer of this outcome.
              Some(outputResponseFormat.write(outputResponseFrom(existing, JsObject.empty))),
              ResolvedAction.OutputDelete(outputId, existing)
            ))
        }
    }

  // ── output create (HEL-1639 D2) ──────────────────────────────────────────

  /** Adds an Output at an existing step of an existing pipeline. `target.parentId` is the pipeline id and `patch` the
   *  create-Output body (`name`, `kind`, `nodeStepId`, `config`). Judged against the pipeline's SAVED steps: the
   *  `nodeStepId` must be one of them, and any `fieldMapping` column must exist in the schema analyze projects at that
   *  node, read with the pipeline OWNER's view (see [[PipelineNodeSchemas]]). */
  private[patchsets] def resolveOutputCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    edit.target.parentId.map(_.trim).filter(_.nonEmpty) match {
      case None =>
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: an output create needs target.parentId, the id of the pipeline to add the Output to")))
      case Some(pipelineIdStr) =>
        decodeCreatePatch[CreateOutputRequest](edit, index) match {
          case Left(err) => Future.successful(Left(err))
          case Right(request) =>
            badRequest(index, outputRequestProblem(request)) match {
              case Some(err) => Future.successful(Left(err))
              case None =>
                val pipelineId = PipelineId(pipelineIdStr)
                authorizeEditorOrOwnerOnPipeline(pipelineId, user, ctx).flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_) =>
                    ctx.pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
                      case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: pipeline not found")))
                      case Some(pipeline) =>
                        val nodeStepId = PipelineStepId(request.nodeStepId.getOrElse(""))
                        PipelineNodeSchemas.schemaAtNode(pipelineId, pipeline.ownerId, nodeStepId, ctx.pipelineRepo, ctx.pipelineStepRepo, ctx.dataSourceRepo).flatMap {
                          case Left(msg) => Future.successful(Left(ServiceError.BadRequest(s"edit $index: $msg")))
                          case Right(schema) =>
                            val kind = OutputKind.fromString(request.kind).getOrElse(OutputKind.Table)
                            val config = request.config.getOrElse(JsObject.empty)
                            // HEL-1779 D4: `OutputFieldMappingCheck` carries the NEW-pipeline rule (any `reads.outputs` is refused, there
                            // being no stored Output yet). Here the pipeline exists, so `reads` is judged by the stored-id check below.
                            val forMapping = if (kind == OutputKind.Insight) JsObject(config.fields - "reads") else config
                            OutputFieldMappingCheck.validate(kind, forMapping, schema) match {
                              case Left(err) => Future.successful(Left(ServiceError.BadRequest(s"edit $index: ${err.message} (node '${nodeStepId.value}')")))
                              case Right(_)  =>
                                insightReadsProblem(kind, None, pipelineId, config, JsObject.empty, ctx).map {
                                  case Left(msg) => Left(ServiceError.BadRequest(s"edit $index: $msg"))
                                  case Right(()) => Right(ResolvedEdit(index, "output", "create", None, ResolvedAction.OutputCreate(pipelineId, request)))
                                }
                            }
                        }
                    }
                }
            }
        }
    }

  private def badRequest(index: Int, problem: Option[String]): Option[ServiceError] =
    problem.map(msg => ServiceError.BadRequest(s"edit $index: $msg"))

  /** The request-shape checks `OutputService.create` makes before it touches the database, plus the patch-set rule that
   *  an Output is attached to a step (`nodeStepId`), never to a root, so its node schema is the one just checked. */
  private def outputRequestProblem(request: CreateOutputRequest): Option[String] =
    if (request.name.trim.isEmpty) Some("name is required")
    else if (request.rootId.isDefined) Some("an output create must name nodeStepId, a step of the pipeline; rootId is not supported here")
    else if (request.nodeStepId.forall(_.trim.isEmpty)) Some("nodeStepId is required: the id of the step of the pipeline that has the columns the Output uses (see get_resource on the pipeline)")
    else
      OutputKind.fromString(request.kind) match {
        case Left(msg) => Some(msg)
        case Right(kind) => OutputService.validateConfig(kind, request.config.getOrElse(JsObject.empty), JsObject.empty).left.toOption.map(_.message)
      }

  /** An output create is judged against the pipeline's SAVED steps, so it is refused when the same set also changes the
   *  Output's node, any step upstream of it, or the pipeline itself: preview and apply would otherwise disagree about
   *  which schema the Output sees. The model proposes the step edits first, then the Output. */
  private[patchsets] def rejectEditedOutputNodes(
      resolved: Vector[ResolvedEdit],
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Option[ServiceError]] = {
    val creates = resolved.collect { case e @ ResolvedEdit(_, _, _, _, ResolvedAction.OutputCreate(pipelineId, request), _, _) => (e, pipelineId, request) }
    if (creates.isEmpty) Future.successful(None)
    else
      // ACL: `listByPipelineInternal` bypasses RLS, but each create here was already resolved by `resolveOutputCreate`, which
      // required owner/editor access on that very pipeline; this only reads its step tree to find the upstream chain.
      Future.traverse(creates) { case (edit, pipelineId, request) =>
        ctx.pipelineStepRepo.listByPipelineInternal(pipelineId).map { steps =>
          val byId = steps.map(s => s.id.value -> s).toMap
          def chain(id: String, seen: Set[String]): Set[String] =
            if (seen(id)) seen else byId.get(id).flatMap(_.parentStepId).map(p => chain(p.value, seen + id)).getOrElse(seen + id)
          val upstream = chain(request.nodeStepId.getOrElse(""), Set.empty)
          val clash = resolved.exists { other =>
            other.action match {
              case ResolvedAction.PipelineStepUpdate(id, _, _)  => upstream(id.value)
              case ResolvedAction.PipelineStepDelete(id, _)     => upstream(id.value)
              case ResolvedAction.PipelineStepCreate(pid, _)    => pid == pipelineId
              case ResolvedAction.PipelineUpdate(id, _, _)      => id == pipelineId
              case ResolvedAction.PipelineDelete(id, _)         => id == pipelineId
              case _                                            => false
            }
          }
          if (clash) Some(ServiceError.BadRequest(
            s"edit ${edit.index}: an output create cannot target a node whose steps are edited in this patch set; propose the step edits first"
          )) else None
        }
      }.map(_.flatten.headOption)
  }

  /** HEL-1779 D4: an insight (created, or whose `reads` this set updates) may not read an Output the same set deletes: apply
   *  would delete it first or last depending on edit order, and the stored-id check at apply sees only the rows then stored.
   *  Judged on the set, like [[rejectEditedOutputNodes]]; the per-edit checks already judged ids against stored state. */
  private[patchsets] def rejectReadsOfDeletedOutputs(resolved: Vector[ResolvedEdit]): Option[ServiceError] = {
    val deleted = resolved.collect { case ResolvedEdit(_, _, _, _, ResolvedAction.OutputDelete(id, _), _, _) => id.value }.toSet
    def readIds(config: JsObject): Vector[String] =
      InsightConfig.parse(config, OutputConfigValidation.isSelectableModel).toOption.flatMap(_.reads.outputs).getOrElse(Vector.empty).map(_.value)
    if (deleted.isEmpty) None
    else
      resolved.view.flatMap { e =>
        val named = e.action match {
          case ResolvedAction.OutputCreate(_, request) if OutputKind.fromString(request.kind).contains(OutputKind.Insight) => readIds(request.config.getOrElse(JsObject.empty))
          case ResolvedAction.OutputUpdate(_, request, prior, priorConfig) if prior.kind == OutputKind.Insight && request.config.exists(_.fields.contains("reads")) =>
            readIds(JsObject(priorConfig.fields ++ request.config.get.fields))
          case _ => Vector.empty
        }
        named.filter(deleted).headOption.map(id => ServiceError.BadRequest(
          s"edit ${e.index}: ${InsightReadsCheck.NamesOtherOutputsMessage}: $id (deleted by another edit in this patch set)"
        ): ServiceError)
      }.headOption
  }
}
