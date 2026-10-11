package com.helio.services.patchsets

import com.helio.domain.panels.PanelConfigCodec
import com.helio.services.panels.{FormBindingValidator, PanelServiceHelpers}
import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse}
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.{AuthenticatedUser, PanelId}
import PatchSetApplyServiceJson._

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
                    Future.successful(Right(ResolvedEdit(
                      index, "panel", "update",
                      Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))),
                      ResolvedAction.PanelUpdate(panelId, request, panel)
                    )))
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
                  case Right(createConfig) =>
                    rejectUnboundOrBadlyBoundForm(request, createConfig, index, user, ctx).map {
                      case Left(err) => Left(err)
                      case Right(_)  => Right(ResolvedEdit(index, "panel", "create", None, ResolvedAction.PanelCreate(request)))
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
}
