package com.helio.services.patchsets

import com.helio.services.panels.PanelServiceHelpers
import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, OutputResponse, PipelineRootSummaryResponse, PipelineStepConfigCodec, PipelineStepResponse, PipelineSummaryResponse, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{DataSourceResponse, StaticDataSourceRequest}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, DataSourceId, DataSourceKind, Output, OutputId, PanelId, PipelineId, PipelineRootId, PipelineStep, PipelineStepId, ResourceAccess}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import spray.json.{JsArray, JsObject, JsValue, JsonReader}

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
      roots                = s.roots.map(r => PipelineRootSummaryResponse(r.id, r.dataSourceId, r.dataSourceName)),
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
        // HEL-913 task 7.6: `roots` replaces the scalar `sourceDataSourceId` -- R8's per-root
        // ACL/blank-id validation, mirroring `PipelineService.resolveRootDataSources`'s own
        // rules (blank id: 400 with NO ownership lookup; unresolvable id: 404). This is a
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
            case Right(()) => Right(ResolvedEdit(index, "pipeline", "create", None, ResolvedAction.PipelineCreate(request)))
          }
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
            authorizeEditorOrOwnerOnPipeline(existing.pipelineId, user, ctx).flatMap {
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
   *  Output bound to it AND every one of those Outputs' panel placements. `ctx.outputRepo ==
   *  null` (a fixture that never wires one) degrades to `boundOutputs: []`, matching this file's
   *  other nullable-optional `outputRepo` conventions. */
  private def buildPipelineStepDeletePriorState(
      existing: PipelineStep,
      rootIdOpt: Option[PipelineRootId],
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[JsValue] = {
    val stepJson = pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(
      existing, rootIdOpt.map(rid => existing.id.value -> rid.value).toMap
    ))
    if (ctx.outputRepo == null) Future.successful(JsObject("step" -> stepJson, "boundOutputs" -> JsArray()))
    else
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
  private def resolvePipelineStepCreate(
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
                authorizeSecondSourceForCreate(request, index, user, ctx).map {
                  case Left(err) => Left(err)
                  case Right(_)  => Right(ResolvedEdit(index, "pipelineStep", "create", None, ResolvedAction.PipelineStepCreate(pipelineId, request)))
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
              // HEL-946: config is deliberately omitted here, not defaulted by
              // a silent overload — this resolved-state snapshot is for a
              // delete, so the Output's config is about to cease to exist and
              // isn't needed by any consumer of this outcome.
              Some(outputResponseFormat.write(outputResponseFrom(existing, JsObject.empty))),
              ResolvedAction.OutputDelete(outputId, existing)
            ))
        }
    }
}
