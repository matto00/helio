package com.helio.services.patchsets

import com.helio.domain.panels.PanelConfigCodec
import com.helio.services.panels.{FormBindingValidator, PanelCreateBuilder, PanelServiceHelpers}
import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, PanelId}
import PatchSetApplyServiceJson._
import spray.json.{JsObject, JsString}

import scala.concurrent.{ExecutionContext, Future}

/** Panel-target resolvers for the patch-set pre-validation pass. Split out of `PatchSetApplyResolvers` (HEL-1479). */
private[patchsets] object PatchSetPanelResolvers {

  import PatchSetResolverSupport.{requireTargetId, authorizeEditorOnDashboard, decodeCreatePatch}

  // HEL-904 task 3.9/4.1: `rejectUnresolvableMetric` and
  // `validatePanelBindingRefs`/`rejectCompanionBinding` removed — metrics no
  // longer exist, and Text/Markdown's data-bound "Source mode" (the only
  // panel kinds that ever carried a rejectable `dataTypeId`) was removed
  // outright in the same task.

  private[patchsets] def resolvePanelUpdate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val panelId = PanelId(idStr)
        ctx.panelRepo.findById(panelId, Some(user)).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound(s"edit $index: panel not found")))
          case Some(panel) =>
            authorizeEditorOnDashboard(panel.dashboardId, user, ctx).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                edit.panelPatch match {
                  case None => Future.successful(Left(ServiceError.BadRequest(s"edit $index: patch is required for a panel update")))
                  case Some(request) =>
                    // HEL-1638 D3: `PanelService.update`'s validation chain over the effective (post-patch) config.
                    ctx.panelDryRun.checkUpdate(panel, request, user).map {
                      case Left(err) => Left(prefixedWithEdit(index, err))
                      case Right(_) => Right(ResolvedEdit(
                        index, "panel", "update",
                        Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))),
                        ResolvedAction.PanelUpdate(panelId, request, panel)
                      ))
                    }
                }
            }
        }
    }

  private[patchsets] def resolvePanelDelete(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    requireTargetId(edit, index) match {
      case Left(err) => Future.successful(Left(err))
      case Right(idStr) =>
        val panelId = PanelId(idStr)
        ctx.panelRepo.findById(panelId, Some(user)).flatMap {
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

  private[patchsets] def resolvePanelCreate(
      edit: Edit,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext,
      refs: PatchSetRefs = PatchSetRefs.empty
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
    rejectMisplacedShape(edit, index).flatMap(_ => decodeCreatePatch[CreatePanelRequest](edit, index)) match {
      case Left(err) => Future.successful(Left(err))
      case Right(request) =>
        outputRefUse(request, index, refs) match {
          case Left(err) => Future.successful(Left(err))
          case Right(use) => resolveValidatedPanelCreate(edit, request, use, index, user, ctx)
        }
    }

  /** HEL-1639 D3: a panel create takes its dashboard from `patch.dashboardId` (never `target.parentId`), and an output
   *  panel binds an Output by id only -- the chart shape (kind, fieldMapping, aggregation) lives on the Output. Both
   *  mistakes used to be silently ignored or reported as a bare "dashboardId is required", so the model repeated them. */
  private def rejectMisplacedShape(edit: Edit, index: Int): Either[ServiceError, Unit] =
    if (edit.target.parentId.exists(_.trim.nonEmpty))
      Left(ServiceError.BadRequest(s"edit $index: a panel create takes its dashboard from patch.dashboardId; remove target.parentId"))
    else {
      val patch  = edit.createPatch.collect { case o: JsObject => o }
      val config = patch.flatMap(_.fields.get("config")).collect { case o: JsObject => o }
      val isOutput = patch.flatMap(_.fields.get("type")).contains(JsString("output"))
      val misplaced = if (isOutput) config.toVector.flatMap(c => Vector("fieldMapping", "aggregation").filter(c.fields.contains)) else Vector.empty
      if (misplaced.isEmpty) Right(())
      else Left(ServiceError.BadRequest(
        s"edit $index: ${misplaced.mkString(" and ")} in a panel's config has no effect: chart shape belongs on the Output (kind + fieldMapping). " +
          "Create the Output with an output create edit (or use an Output that already has that shape) and bind the panel with config.outputId only"
      ))
    }

  /** A `config.outputId` of `"$ref:<ref>"` must name an EARLIER output create of the same set. */
  private def outputRefUse(request: CreatePanelRequest, index: Int, refs: PatchSetRefs): Either[ServiceError, Option[OutputRefUse]] =
    request.config.collect { case o: JsObject => o }.flatMap(_.fields.get("outputId")).collect { case JsString(id) => id }.flatMap(PatchSetRefs.refOf) match {
      case None      => Right(None)
      case Some(ref) => PatchSetRefs.resolveUse(ref, index, refs).map(Some(_))
    }

  private def resolveValidatedPanelCreate(
      edit: Edit,
      request: CreatePanelRequest,
      use: Option[OutputRefUse],
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, ResolvedEdit]] =
        PanelServiceHelpers.validateCreatePanelRequest(request) match {
          case Left(msg) => Future.successful(Left(ServiceError.BadRequest(s"edit $index: $msg")))
          case Right(dashboardId) =>
            authorizeEditorOnDashboard(dashboardId, user, ctx).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                PanelServiceHelpers.resolveCreateConfig(request) match {
                  case Left(msg) => Future.successful(Left(ServiceError.BadRequest(s"edit $index: $msg")))
                  case Right(createConfig) =>
                    rejectUnboundOrBadlyBoundForm(request, createConfig, index, user, ctx).flatMap {
                      case Left(err) => Future.successful(Left(err))
                      case Right(_) =>
                        // HEL-1638 D3: `PanelService.create`'s build checks. A `$ref` Output does not exist yet (Sentinel);
                        // any other binding is checked as apply checks it.
                        val binding = if (use.isDefined) PanelCreateBuilder.Binding.Sentinel else PanelCreateBuilder.Binding.Real
                        ctx.panelDryRun.check(request, user, binding).map {
                          case Left(err) => Left(prefixedWithEdit(index, err))
                          case Right(_)  => Right(ResolvedEdit(index, "panel", "create", None, ResolvedAction.PanelCreate(request), outputRefUse = use))
                        }
                    }
                }
            }
        }

  /** HEL-1148 design.md D4 "Patch-set create": a `form` panel created by a patch-set must carry a
   *  non-empty `config.dataSourceId` and pass the shared `FormBindingValidator` (caller-owned,
   *  `dataset` kind, fields fit the declared schema), each rejection naming the edit. This is
   *  deliberately patch-set-specific, NOT part of `PanelService.create`, which stays as strict as
   *  it already was; without it an unbound/foreign-sourced form only failed (or, with an unwired
   *  repo, silently passed) at the forward write instead of being rejected up front. */
  private def rejectUnboundOrBadlyBoundForm(
      request: CreatePanelRequest,
      createConfig: PanelConfigCodec.CreateConfig,
      index: Int,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    createConfig match {
      case PanelConfigCodec.FormCreate(config) if config.dataSourceId.value.trim.isEmpty =>
        Future.successful(Left(ServiceError.BadRequest(
          s"edit $index: a form panel requires config.dataSourceId (the id of a dataset source)"
        )))
      case PanelConfigCodec.FormCreate(_) =>
        FormBindingValidator.rejectForCreate(ctx.dataSourceRepo, request, user).map {
          case Left(ServiceError.NotFound(msg))   => Left(ServiceError.NotFound(s"edit $index: $msg"))
          case Left(ServiceError.BadRequest(msg)) => Left(ServiceError.BadRequest(s"edit $index: $msg"))
          case other                              => other
        }
      case _ => Future.successful(Right(()))
    }

  private def prefixedWithEdit(index: Int, err: ServiceError): ServiceError = err match {
    case ServiceError.UnprocessableEntity(msg) => ServiceError.UnprocessableEntity(s"edit $index: $msg")
    case ServiceError.BadRequest(msg)          => ServiceError.BadRequest(s"edit $index: $msg")
    case ServiceError.NotFound(msg)            => ServiceError.NotFound(s"edit $index: $msg")
    case other                                 => other
  }
}
