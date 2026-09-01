package com.helio.services.patchsets

import com.helio.services.panels.PanelServiceHelpers
import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, OutputResponse, PipelineStepConfigCodec, PipelineStepResponse, PipelineSummaryResponse, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{DataSourceResponse, StaticDataSourceRequest}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, DataSourceId, DataSourceKind, Output, OutputId, PanelId, PipelineId, PipelineStep, PipelineStepId, ResourceAccess}
import com.helio.domain.{JoinConfig, LookupConfig, UnionConfig}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
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
 *  Extracted from `PatchSetApplyService.scala` to keep that file within a
 *  manageable size — every function here is a pure(-ish), read-only
 *  resolver taking its collaborators via [[PatchSetApplyContext]] rather
 *  than storing them as fields, so it needs no class/trait wiring of its
 *  own. */
private[services] object PatchSetApplyResolvers {

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
      case ("pipelineStep", "create") =>
        // design.md D1: EditTarget has no field carrying a not-yet-existing
        // step's PARENT pipeline id — a create-op edit can't target one.
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: create is not supported for pipelineStep")))
      case ("output", "update") => resolveOutputUpdate(edit, index, user, ctx)
      case ("output", "delete") => resolveOutputDelete(edit, index, user, ctx)
      case ("output", "create") =>
        // HEL-907 task 1.2: same reason as pipelineStep above -- CreateOutputRequest carries no
        // parent-pipeline-id field of its own (the real route takes it from the URL path), and
        // EditTarget has no field for a not-yet-existing resource's parent id either.
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: create is not supported for output")))
      case (kind, op) =>
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: unsupported target.kind '$kind' for op '$op'")))
    }


  private def requireTargetId(edit: Edit, index: Int): Either[ServiceError, String] =
    edit.target.id.map(_.trim).filter(_.nonEmpty) match {
      case Some(id) => Right(id)
      case None     => Left(ServiceError.BadRequest(s"edit $index: target.id is required for op '${edit.op}'"))
    }

  private def authorizeEditorOnDashboard(
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
  private def authorizeEditorOrOwnerOnPipeline(
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

  private def decodeCreatePatch[T](edit: Edit, index: Int)(implicit reader: JsonReader[T]): Either[ServiceError, T] =
    edit.createPatch match {
      case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for a create edit"))
      case Some(json) =>
        Try(reader.read(json)) match {
          case Success(value) => Right(value)
          case Failure(ex)    => Left(ServiceError.BadRequest(s"edit $index: patch does not match the expected shape (${ex.getMessage})"))
        }
    }

  private def pipelineSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      sourceDataSourceId   = s.sourceDataSourceId,
      sourceDataSourceName = s.sourceDataSourceName,
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None,
      tag                  = s.tag
    )


  // HEL-904 task 3.9/4.1: `rejectUnresolvableMetric` and
  // `validatePanelBindingRefs`/`rejectCompanionBinding` removed — metrics no
  // longer exist, and Text/Markdown's data-bound "Source mode" (the only
  // panel kinds that ever carried a rejectable `dataTypeId`) was removed
  // outright in the same task.

  /** pipelineStep update: when the decoded config patch is a
   *  `JoinConfig`/`UnionConfig`/`LookupConfig`, the SAME "Pre-flight ACL"
   *  owner-only check `PipelineService.updateStep`/`addStep` already run,
   *  mirrored (`PipelineService.scala:568-597`). */
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
        PipelineStep.companionFor(existing.kind).toOption
          .flatMap(_.validateRawConfig(cfgJson.compactPrint)) match {
          case Some(msg) =>
            Future.successful(Left(ServiceError.UnprocessableEntity(s"edit $index: $msg")))
          case None =>
        PipelineStepConfigCodec.decode(existing.kind, cfgJson.compactPrint) match {
          case Failure(_) =>
            Future.successful(Left(ServiceError.BadRequest(s"edit $index: invalid '${existing.kind}' config")))
          case Success(jc: JoinConfig) =>
            ctx.dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user).map {
              case None    => Left(ServiceError.NotFound(s"edit $index: data source not found: ${jc.rightDataSourceId}"))
              case Some(_) => Right(())
            }
          case Success(uc: UnionConfig) =>
            ctx.dataSourceRepo.findByIdOwned(DataSourceId(uc.otherDataSourceId), user).map {
              case None    => Left(ServiceError.NotFound(s"edit $index: data source not found: ${uc.otherDataSourceId}"))
              case Some(_) => Right(())
            }
          case Success(lc: LookupConfig) if lc.referenceDataSourceId.nonEmpty =>
            ctx.dataSourceRepo.findByIdOwned(DataSourceId(lc.referenceDataSourceId), user).map {
              case None    => Left(ServiceError.NotFound(s"edit $index: data source not found: ${lc.referenceDataSourceId}"))
              case Some(_) => Right(())
            }
          case Success(_) => Future.successful(Right(()))
        }
        }
    }


  private def resolvePanelUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val panelId = PanelId(idStr)
        ctx.panelRepo.findByIdInternal(panelId).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: panel not found")))
          case Some(panel) =>
            authorizeEditorOnDashboard(panel.dashboardId, user, ctx).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                edit.panelPatch match {
                  case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: patch is required for a panel update")))
                  case Some(request) =>
                    Future.successful(Right(ResolvedEdit(
                      index, "panel", "update",
                      Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))),
                      ResolvedAction.PanelUpdate(panelId, request, panel)
                    )))
                }
            }
        }
    }

  private def resolvePanelDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val panelId = PanelId(idStr)
        ctx.panelRepo.findByIdInternal(panelId).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: panel not found")))
          case Some(panel) =>
            authorizeEditorOnDashboard(panel.dashboardId, user, ctx).map {
              case Left(err) => Left(err)
              case Right(_) =>
                Right(ResolvedEdit(
                  index, "panel", "delete",
                  Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))),
                  ResolvedAction.PanelDelete(panelId, panel)
                ))
            }
        }
    }

  private def resolvePanelCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    decodeCreatePatch[CreatePanelRequest](edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(request) =>
        PanelServiceHelpers.validateCreatePanelRequest(request) match {
          case Left(msg) => Future.successful(Left(ServiceError.BadRequest(s"edit $index: $msg")))
          case Right(dashboardId) =>
            authorizeEditorOnDashboard(dashboardId, user, ctx).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                PanelServiceHelpers.resolveCreateConfig(request) match {
                  case Left(msg) => Future.successful(Left(ServiceError.BadRequest(s"edit $index: $msg")))
                  case Right(_) =>
                    Future.successful(Right(ResolvedEdit(index, "panel", "create", None, ResolvedAction.PanelCreate(request))))
                }
            }
        }
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


  private def resolveDataSourceUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val sourceId = DataSourceId(idStr)
        ctx.dataSourceRepo.findByIdOwned(sourceId, user).map {
          case None => Left(ServiceError.NotFound(s"edit $index: data source not found"))
          case Some(existing) =>
            edit.dataSourcePatch match {
              case None => Left(ServiceError.BadRequest(s"edit $index: patch is required for a dataSource update"))
              case Some(request) =>
                Right(ResolvedEdit(
                  index, "dataSource", "update",
                  Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(existing))),
                  ResolvedAction.DataSourceUpdate(sourceId, request, existing)
                ))
            }
        }
    }

  private def resolveDataSourceDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val sourceId = DataSourceId(idStr)
        ctx.dataSourceRepo.findByIdOwned(sourceId, user).map {
          case None => Left(ServiceError.NotFound(s"edit $index: data source not found"))
          case Some(existing) =>
            Right(ResolvedEdit(
              index, "dataSource", "delete",
              Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(existing))),
              ResolvedAction.DataSourceDelete(sourceId, existing)
            ))
        }
    }

  private def resolveDataSourceCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    decodeCreatePatch[StaticDataSourceRequest](edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(request) if request.`type` != DataSourceKind.Static =>
        // design.md D1: only `static` is supported (pure JSON, no I/O) — the
        // other nine create variants need file bytes or live I/O.
        Future.successful(Left(ServiceError.BadRequest(s"edit $index: dataSource create only supports type '${DataSourceKind.Static}'")))
      case Right(request) =>
        Future.successful(Right(ResolvedEdit(index, "dataSource", "create", None, ResolvedAction.DataSourceCreate(request))))
    }




  private def resolvePipelineUpdate(
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

  private def resolvePipelineDelete(
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

  private def resolvePipelineCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    decodeCreatePatch[CreatePipelineRequest](edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(request) =>
        val sourceIdTrimmed = request.sourceDataSourceId.trim
        if (sourceIdTrimmed.isEmpty)
          Future.successful(Left(ServiceError.BadRequest(s"edit $index: sourceDataSourceId is required")))
        else
          // design.md D2a: mirrors PipelineRepository.create's own owner-only check.
          ctx.dataSourceRepo.findByIdOwned(DataSourceId(sourceIdTrimmed), user).map {
            case None    => Left(ServiceError.NotFound(s"edit $index: data source not found"))
            case Some(_) => Right(ResolvedEdit(index, "pipeline", "create", None, ResolvedAction.PipelineCreate(request)))
          }
    }


  private def resolvePipelineStepUpdate(
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
            authorizeEditorOrOwnerOnPipeline(existing.pipelineId, user, ctx).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                edit.pipelineStepPatch match {
                  case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: patch is required for a pipelineStep update")))
                  case Some(request) =>
                    validateEmbeddedStepReferences(existing, request, user, index, ctx).map {
                      case Left(err) => Left(err)
                      case Right(_) =>
                        Right(ResolvedEdit(
                          index, "pipelineStep", "update",
                          Some(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(existing))),
                          ResolvedAction.PipelineStepUpdate(stepId, request, existing)
                        ))
                    }
                }
            }
        }
    }

  private def resolvePipelineStepDelete(
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
            authorizeEditorOrOwnerOnPipeline(existing.pipelineId, user, ctx).map {
              case Left(err) => Left(err)
              case Right(_) =>
                Right(ResolvedEdit(
                  index, "pipelineStep", "delete",
                  Some(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(existing))),
                  ResolvedAction.PipelineStepDelete(stepId, existing)
                ))
            }
        }
    }

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

  private def resolveOutputUpdate(
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

  private def resolveOutputDelete(
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
              Some(outputResponseFormat.write(outputResponseFrom(existing))),
              ResolvedAction.OutputDelete(outputId, existing)
            ))
        }
    }
}
