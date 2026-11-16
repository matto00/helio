package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.Edit
import com.helio.api.protocols.pipelines.CreateOutputRequest
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, OutputKind, PipelineId, PipelineStepId}
import com.helio.services.pipelines.{OutputFieldMappingCheck, OutputService, PipelineNodeSchemas}
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
                  case Some(request) =>
                    Right(ResolvedEdit(
                      index, "output", "update",
                      Some(outputResponseFormat.write(outputResponseFrom(existing, existingConfig))),
                      ResolvedAction.OutputUpdate(outputId, request, existing, existingConfig)
                    ))
                }
            }
        }
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
                        PipelineNodeSchemas.schemaAtNode(pipelineId, pipeline.ownerId, nodeStepId, ctx.pipelineRepo, ctx.pipelineStepRepo, ctx.dataSourceRepo).map {
                          case Left(msg) => Left(ServiceError.BadRequest(s"edit $index: $msg"))
                          case Right(schema) =>
                            val kind = OutputKind.fromString(request.kind).getOrElse(OutputKind.Table)
                            OutputFieldMappingCheck.validate(kind, request.config.getOrElse(JsObject.empty), schema) match {
                              case Left(err) => Left(ServiceError.BadRequest(s"edit $index: ${err.message} (node '${nodeStepId.value}')"))
                              case Right(_)  => Right(ResolvedEdit(index, "output", "create", None, ResolvedAction.OutputCreate(pipelineId, request)))
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
}
