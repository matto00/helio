package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, PipelineRootSummaryResponse, PipelineSummaryResponse}
import com.helio.api.protocols.patchsets.Edit
import com.helio.services.pipelines.{PipelineCreateDryRun, PipelineRootDryRun, PipelineRootWrites}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind, PipelineId}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import PatchSetResolverSupport.prefixedWithEdit

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
          // HEL-1638 D1b: `PipelineCreateWrites.checkedCreate`'s order -- (1) per root in order: shape (apply's messages via
          // `PipelineRootWrites.shapeProblem`) and existing-source ownership; (2) the request-only preflight and cross-owner
          // refs; (3) each root's schema as apply would persist it (inline create checks, budgeted live fetch), then the
          // Output column check. The same `PipelineCreateDryRun` the proposal path runs. Apply's own `create` re-checks.
          val dryRun = new PipelineCreateDryRun(ctx.dataSourceRepo)
          def rootsLoop(remaining: List[CreatePipelineRootRequest]): Future[Either[ServiceError, Unit]] = remaining match {
            case Nil => Future.successful(Right(()))
            case root :: rest =>
              PipelineRootWrites.shapeProblem(root) match {
                case Some(err) => Future.successful(Left(err))
                case None =>
                  root.sourceId.map(_.trim) match {
                    case Some(sid) =>
                      ctx.dataSourceRepo.findByIdOwned(DataSourceId(sid), user).flatMap {
                        case None    => Future.successful(Left(ServiceError.NotFound(s"data source not found: $sid")))
                        case Some(_) => rootsLoop(rest)
                      }
                    case None => rootsLoop(rest)
                  }
              }
          }
          def rootSpec(root: CreatePipelineRootRequest): PipelineRootDryRun.Spec = {
            val name = root.name.map(_.trim).getOrElse("")
            root.sourceId.map(_.trim) match {
              case Some(sid) => PipelineRootDryRun.Spec.Existing(sid)
              case None =>
                DataSourceKind.canonicalize(root.`type`.getOrElse("")) match {
                  case DataSourceKind.Csv     => PipelineRootDryRun.Spec.Csv
                  case DataSourceKind.Sql     => PipelineRootDryRun.Spec.Sql(name, root.sqlConfig.get)
                  case DataSourceKind.RestApi => PipelineRootDryRun.Spec.Rest(name, root.restConfig.get)
                  case _                      => PipelineRootDryRun.Spec.Static(name, root.staticConfig.get)
                }
            }
          }
          def rootSchemas(): Future[Either[ServiceError, Vector[PipelineRootDryRun.Root]]] =
            request.roots.zipWithIndex.foldLeft(Future.successful[Either[ServiceError, Vector[PipelineRootDryRun.Root]]](Right(Vector.empty))) {
              case (acc, (root, i)) =>
                acc.flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(done) =>
                    ctx.rootDryRun.rootSchema(rootSpec(root), s"roots[$i]", user, ctx.chargeFetches, "data source not found", ServiceError.UnprocessableEntity("inline csv sources are not supported for pipeline roots")).map(_.map(done :+ _))
                }
            }
          val checked: Future[Either[ServiceError, Unit]] =
            rootsLoop(request.roots.toList).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(()) =>
                dryRun.preflight(request, user).flatMap {
                  case Left(err)   => Future.successful(Left(err))
                  // HEL-1722 D5: preflight returns `None` for a create with roots but no steps or Outputs, and the root dry run used to be skipped
                  // there, so a PREVIEW never ran an inline root's create checks (`validateStatic`, `validateSqlCreate`, `validateRestCreate`).
                  // It runs now, discarding the schemas. Apply (`chargeFetches = false`) keeps skipping it: `PipelineService.create` re-runs those
                  // checks authoritatively before it writes, and re-running them here would add a second live rest/sql fetch to every apply. A
                  // fetch failure alone does not reject (apply records an unrunnable run).
                  case Right(None) => if (ctx.chargeFetches) rootSchemas().map(_.map(_ => ())) else Future.successful(Right(()))
                  case Right(Some(indices)) =>
                    rootSchemas().flatMap {
                      case Left(err)    => Future.successful(Left(err))
                      case Right(roots) =>
                        dryRun.checkOutputs(request, indices, roots.map(_.schema), roots.zipWithIndex.collect { case (r, i) if r.fetchError.isDefined => i -> r.fetchError.get }.toMap, user)
                    }
                }
            }
          checked.map {
            case Left(err) => Left(prefixedWithEdit(index, err))
            case Right(()) => Right(ResolvedEdit(index, "pipeline", "create", None, ResolvedAction.PipelineCreate(request)))
          }
        }
    }
}
