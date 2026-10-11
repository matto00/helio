package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, PipelineId, ResourceAccess}
import PatchSetApplyServiceJson._
import spray.json.JsonReader

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Pre-validation pass (design.md D2/D2a, tasks.md 3.1/3.2): resolves every
 *  edit — target exists + is accessible per the SAME access rule its own
 *  kind's real update/delete path enforces for that SPECIFIC op, and `patch`
 *  decodes to the shape its `(kind, op)` requires — into a [[ResolvedEdit]],
 *  before [[PatchSetApplyService]] mutates anything. A `Left` from ANY
 *  resolver fails the whole pass; nothing is mutated.
 *
 *  This object holds the entry point (`resolveAll`), the `(kind, op)` dispatch (`resolveEdit`)
 *  and the three `dashboard` resolvers. The other target kinds' resolvers live in
 *  `PatchSetPanelResolvers`, `PatchSetDataSourceResolvers`, `PatchSetPipelineResolvers`,
 *  `PatchSetPipelineStepResolvers` and `PatchSetOutputResolvers` (split out in HEL-1479); the
 *  access/decode helpers they share are `PatchSetResolverSupport`, at the bottom of this file.
 *
 *  Extracted from `PatchSetApplyService.scala` to keep that file within a
 *  manageable size — every function here is a pure(-ish), read-only
 *  resolver taking its collaborators via [[PatchSetApplyContext]] rather
 *  than storing them as fields, so it needs no class/trait wiring of its
 *  own. */
private[services] object PatchSetApplyResolvers {

  import PatchSetResolverSupport.{requireTargetId, decodeCreatePatch}
  import PatchSetPanelResolvers.{resolvePanelUpdate, resolvePanelDelete, resolvePanelCreate}
  import PatchSetDataSourceResolvers.{resolveDataSourceUpdate, resolveDataSourceDelete, resolveDataSourceCreate}
  import PatchSetPipelineResolvers.{resolvePipelineUpdate, resolvePipelineDelete, resolvePipelineCreate}
  import PatchSetPipelineStepResolvers.{resolvePipelineStepUpdate, resolvePipelineStepDelete, resolvePipelineStepCreate}
  import PatchSetOutputResolvers.{resolveOutputUpdate, resolveOutputDelete}

  def resolveAll(
      edits: Vector[Edit],
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Vector[ResolvedEdit]]] = {
    def loop(remaining: Vector[(Edit, Int)], acc: Vector[ResolvedEdit]): Future[Either[ServiceError, Vector[ResolvedEdit]]] =
      remaining.headOption match {
        case None => Future.successful(Right(acc))
        case Some((edit, index)) =>
          resolveEdit(edit, index, user, ctx).flatMap {
            case Left(err)       => Future.successful(Left(err))
            case Right(resolved) => loop(remaining.tail, acc :+ resolved)
          }
      }
    loop(edits.zipWithIndex, Vector.empty)
  }

  private def resolveEdit(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    // HEL-914 task 5.1/D3: `target.parentId` is REJECTED, not ignored, on update/delete --
    // checked once, generically, here rather than duplicated into every update/delete resolver.
    if ((edit.op == "update" || edit.op == "delete") && edit.target.parentId.exists(_.trim.nonEmpty)) {
      Future.successful(Left(ServiceError.BadRequest(s"edit $index: target.parentId must be omitted when op is '${edit.op}'")))
    } else
    (edit.target.kind, edit.op) match {
      case ("panel", "update")        => resolvePanelUpdate(edit, index, user, ctx)
      case ("panel", "delete")        => resolvePanelDelete(edit, index, user, ctx)
      case ("panel", "create")        => resolvePanelCreate(edit, index, user, ctx)
      case ("dashboard", "update")    => resolveDashboardUpdate(edit, index, user, ctx)
      case ("dashboard", "delete")    => resolveDashboardDelete(edit, index, user, ctx)
      case ("dashboard", "create")    => resolveDashboardCreate(edit, index, user, ctx)
      case ("dataSource", "update")   => resolveDataSourceUpdate(edit, index, user, ctx)
      case ("dataSource", "delete")   => resolveDataSourceDelete(edit, index, user, ctx)
      case ("dataSource", "create")   => resolveDataSourceCreate(edit, index, user, ctx)
      // HEL-904 task 3.3: the "dataType" target kind is REMOVED outright
      // (dropped from `recognizedKinds`, so this dispatch never actually
      // reaches here) -- an unmatched fallthrough case below covers it.
      case ("pipeline", "update")     => resolvePipelineUpdate(edit, index, user, ctx)
      case ("pipeline", "delete")     => resolvePipelineDelete(edit, index, user, ctx)
      case ("pipeline", "create")     => resolvePipelineCreate(edit, index, user, ctx)
      case ("pipelineStep", "update") => resolvePipelineStepUpdate(edit, index, user, ctx)
      case ("pipelineStep", "delete") => resolvePipelineStepDelete(edit, index, user, ctx)
      case ("pipelineStep", "create") => resolvePipelineStepCreate(edit, index, user, ctx)
      case ("output", "update") => resolveOutputUpdate(edit, index, user, ctx)
      case ("output", "delete") => resolveOutputDelete(edit, index, user, ctx)
      case ("output", "create") =>
        // HEL-914 task 5.1/6b.6/6b.7: `EditTarget.parentId` (added for `pipelineStep` create,
        // above) makes an `output` create REPRESENTABLE too, but this ticket neither implements
        // nor tests one -- a deliberate, documented absence, not a remaining impossibility (the
        // parent-id gap that used to explain rejecting THIS kind is closed; only lack of
        // coverage keeps it rejected).
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: create is not supported for output")))
      case (kind, op) =>
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: unsupported target.kind '$kind' for op '$op'")))
    }

  private def resolveDashboardUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val dashboardId = DashboardId(idStr)
        ctx.dashboardRepo.findById(dashboardId, Some(user)).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: dashboard not found")))
          case Some(existing) if existing.ownerId == user.id =>
            Future.successful(buildDashboardUpdateResolved(edit, index, existing))
          case Some(existing) =>
            ctx.accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
              case Left(err)                    => Left(err)
              case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())
              case Right(_)                     => buildDashboardUpdateResolved(edit, index, existing)
            }
        }
    }

  private def buildDashboardUpdateResolved(edit: Edit, index: Int, existing: Dashboard): Either[ServiceError, ResolvedEdit] =
    edit.dashboardPatch match {
      case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for a dashboard update"))
      case Some(request) =>
        Right(ResolvedEdit(
          index, "dashboard", "update",
          Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(existing))),
          ResolvedAction.DashboardUpdate(existing.id, request, existing)
        ))
    }

  /** design.md D2: dashboard delete is a DIFFERENT, owner-only rule — unlike
   *  update, does NOT go through `accessChecker` at all (matches
   *  `DashboardService.delete` exactly). */
  private def resolveDashboardDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val dashboardId = DashboardId(idStr)
        ctx.dashboardRepo.findById(dashboardId, Some(user)).map {
          case None                                          => Left(ServiceError.NotFound(s"edit $index: dashboard not found"))
          case Some(existing) if existing.ownerId != user.id => Left(ServiceError.Forbidden())
          case Some(existing) =>
            Right(ResolvedEdit(
              index, "dashboard", "delete",
              Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(existing))),
              ResolvedAction.DashboardDelete(dashboardId, existing)
            ))
        }
    }

  private def resolveDashboardCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    decodeCreatePatch[CreateDashboardRequest](edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(request) if request.ifExists.isDefined =>
        // design.md D3a: this contract only ever creates — idempotent
        // get-or-create would break rollback symmetry (a create->delete
        // compensation can't distinguish "returned existing" from "created").
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: dashboard create does not support ifExists")))
      case Right(request) =>
        Future.successful(Right(ResolvedEdit(index, "dashboard", "create", None, ResolvedAction.DashboardCreate(request))))
    }

}

/** Access/decode helpers shared by the patch-set resolvers. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetResolverSupport {

  private[patchsets] def requireTargetId(edit: Edit, index: Int): Either[ServiceError, String] =
    edit.target.id.map(_.trim).filter(_.nonEmpty) match {
      case Some(id) => Right(id)
      case None     => Left(ServiceError.BadRequest(s"edit $index: target.id is required for op '${edit.op}'"))
    }

  private[patchsets] def authorizeEditorOnDashboard(
      dashboardId: DashboardId,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    ctx.accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
      case Left(err)                    => Left(err)
      case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())
      case Right(_)                     => Right(())
    }

  /** design.md D2: pipelineStep's pipeline-level owner-or-editor check —
   *  IDENTICAL for update/delete, mirrors `PipelineService.updateStep`/
   *  `deleteStep` exactly. */
  private[patchsets] def authorizeEditorOrOwnerOnPipeline(
      pipelineId: PipelineId,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    ctx.pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Pipeline not found")))
      case Some(pipeline) if pipeline.ownerId == user.id => Future.successful(Right(()))
      case Some(pipeline) =>
        ctx.pipelineRepo.findGrantRole(pipeline.id, user).map {
          case Some("editor") => Right(())
          case _              => Left(ServiceError.Forbidden())
        }
    }

  /** HEL-1002: a step is found with the ACL-bypassing `findByIdInternal`, so a caller who cannot see
   *  its pipeline must get exactly the absent-step message (not `authorizeEditorOrOwnerOnPipeline`'s
   *  `Pipeline not found`, which would reveal that the step exists). Visible-but-viewer stays 403. */
  private[patchsets] def requireVisibleStep(
      pipelineId: PipelineId,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    ctx.pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None    => Future.successful(Left(ServiceError.NotFound(s"edit $index: pipeline step not found")))
      case Some(_) => authorizeEditorOrOwnerOnPipeline(pipelineId, user, ctx)
    }

  private[patchsets] def decodeCreatePatch[T](edit: Edit, index: Int)(implicit reader: JsonReader[T]): Either[ServiceError, T] =
    edit.createPatch match {
      case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for a create edit"))
      case Some(json) =>
        Try(reader.read(json)) match {
          case Success(value) => Right(value)
          case Failure(ex)    => Left(ServiceError.BadRequest(s"edit $index: patch does not match the expected shape (${ex.getMessage})"))
        }
    }
}
