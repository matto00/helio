package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, PipelineRootSummaryResponse, PipelineSummaryResponse}
import com.helio.api.protocols.patchsets.Edit
import com.helio.services.pipelines.PipelineCreatePreflight
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineId}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._

import scala.concurrent.{ExecutionContext, Future}

/** Pipeline-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetPipelineResolvers {

  import PatchSetResolverSupport.{requireTargetId, decodeCreatePatch}

  private def pipelineSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      roots                = s.roots.map(r => PipelineRootSummaryResponse(r.id, r.dataSourceId, r.dataSourceName)),
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None,
      tag                  = s.tag,
      createdAt            = s.createdAt,
      updatedAt            = s.updatedAt
    )

  private[patchsets] def resolvePipelineUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val pipelineId = PipelineId(idStr)
        ctx.pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: pipeline not found")))
          case Some(_) =>
            // design.md D4a: capture the joined PipelineSummary HERE (not the
            // bare findByIdOwned Pipeline) — the one kind needing a
            // deliberate second read for priorState/resultingState.
            ctx.pipelineRepo.findSummaryById(pipelineId, user).map {
              case None => Left(ServiceError.NotFound(s"edit $index: pipeline not found"))
              case Some(summary) =>
                edit.pipelinePatch match {
                  case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for a pipeline update"))
                  case Some(request) =>
                    Right(ResolvedEdit(
                      index, "pipeline", "update",
                      Some(pipelineSummaryResponseFormat.write(pipelineSummaryResponse(summary))),
                      ResolvedAction.PipelineUpdate(pipelineId, request, summary)
                    ))
                }
            }
        }
    }

  private[patchsets] def resolvePipelineDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val pipelineId = PipelineId(idStr)
        ctx.pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: pipeline not found")))
          case Some(_) =>
            ctx.pipelineRepo.findSummaryById(pipelineId, user).map {
              case None => Left(ServiceError.NotFound(s"edit $index: pipeline not found"))
              case Some(summary) =>
                Right(ResolvedEdit(
                  index, "pipeline", "delete",
                  Some(pipelineSummaryResponseFormat.write(pipelineSummaryResponse(summary))),
                  ResolvedAction.PipelineDelete(pipelineId, summary)
                ))
            }
        }
    }

  private def prefixedWithEdit(index: Int, err: ServiceError): ServiceError = err match {
    case ServiceError.UnprocessableEntity(msg) => ServiceError.UnprocessableEntity(s"edit $index: $msg")
    case ServiceError.BadRequest(msg)          => ServiceError.BadRequest(s"edit $index: $msg")
    case other                                 => other
  }

  private[patchsets] def resolvePipelineCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    decodeCreatePatch[CreatePipelineRequest](edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(request) =>
        // HEL-913 task 7.6: `roots` replaces the scalar `sourceDataSourceId` -- R8's per-root
        // ACL/blank-id validation, mirroring `PipelineRootWrites.resolveOneRootSourceId`'s
        // blank-id rule (400 with NO ownership lookup) and `PipelineCreateWrites.lookupOwnedRoots`'s
        // unresolvable/unowned-id rule (404). This is a
        // preview-time pre-check only -- `PatchSetApplyForward`'s real apply calls
        // `pipelineService.create` itself, which re-validates authoritatively; this exists so a
        // resolve-time 404/400 doesn't wait until apply to surface.
        if (request.roots.isEmpty)
          Future.successful(Left(ServiceError.BadRequest(s"edit $index: roots must be a non-empty array")))
        else {
          def loop(remaining: List[CreatePipelineRootRequest]): Future[Either[ServiceError, Unit]] = remaining match {
            case Nil => Future.successful(Right(()))
            case root :: rest =>
              // HEL-913 task 7.1a: an inline root (`sourceId` absent, `type` present) has no
              // id yet to pre-check here -- apply-time `pipelineService.create` (this file's
              // own doc, above) re-validates it authoritatively, inline branch included.
              root.sourceId.map(_.trim) match {
                case Some(sid) if sid.isEmpty =>
                  Future.successful(Left(ServiceError.BadRequest(s"edit $index: roots: sourceId is required and must not be blank")))
                case Some(sid) =>
                  ctx.dataSourceRepo.findByIdOwned(DataSourceId(sid), user).flatMap {
                    case None    => Future.successful(Left(ServiceError.NotFound(s"edit $index: data source not found: $sid")))
                    case Some(_) => loop(rest)
                  }
                case None => loop(rest)
              }
          }
          loop(request.roots.toList).map {
            case Left(err) => Left(err)
            case Right(()) =>
              // HEL-1402/HEL-1469: the SAME request-only step/Output pre-flight `PipelineService.create`
              // runs before it creates any inline root source, surfaced at resolve time (4xx, nothing
              // applied, no source created) instead of a forward-apply failure reported as HTTP 200 --
              // for apply AND preview (which shares `resolveAll`). Root errors above stay first.
              PipelineCreatePreflight.run(request).left.map(prefixedWithEdit(index, _))
                .map(_ => ResolvedEdit(index, "pipeline", "create", None, ResolvedAction.PipelineCreate(request)))
          }
        }
    }
}
