package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreatePanelRequest, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure.{DataTypeRepository, PanelRepository}
import com.helio.services.PanelServiceHelpers._
import spray.json.JsValue

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** A pre-validated, normalized snapshot of an `UpdatePanelRequest`.
 *
 *  CS2c-3c collapses the prior 14-field flat shape to four fields: title,
 *  appearance, type (with cross-type 400 lock at apply time), and a raw
 *  `config: JsValue` patch that the per-subtype `*Config.Patch.decode`
 *  resolves at apply time. */
final case class ResolvedPanelPatch(
    trimmedTitle: Option[String],
    appearance:   Option[PanelAppearance],
    panelType:    Option[PanelType],
    configPatch:  Option[JsValue]
) {
  def hasAnyField: Boolean =
    trimmedTitle.isDefined || appearance.isDefined || panelType.isDefined || configPatch.isDefined
}

/** Business logic for `/api/panels`. Absorbs the prior `PanelPatchService` so
 *  the patch resolver + step-by-step applier live with the rest of panel CRUD.
 *
 *  ACL strategy (CS4):
 *  - `findById` uses `panelRepo.findById(id, Some(user))` — sharing-aware via
 *    the parent dashboard. This closes the `/api/panels/:id/query` hole where
 *    any authenticated user could query any panel regardless of dashboard ACL.
 *  - `batchUpdate` uses `panelRepo.findByIdInternal` — the parent dashboard
 *    ACL (via `accessChecker.requireAccess`) is the authoritative gate there;
 *    per-panel owner checks are collapsed.
 *  - `delete` / `duplicate` / `update` delegate to the dashboard-level ACL
 *    via `authorizeEditorOnDashboard`. */
final class PanelService(
    panelRepo:     PanelRepository,
    dataTypeRepo:  DataTypeRepository,
    accessChecker: AccessChecker
)(implicit ec: ExecutionContext) {

  private val patchApplier = new PanelPatchApplier(panelRepo)

  // ── Read ──────────────────────────────────────────────────────────────────

  /** Sharing-aware read. Returns the panel only when the caller has access
   *  to the parent dashboard (owner, grantee, or public viewer when
   *  `callerOpt = None`). Closes the `/api/panels/:id/query` ACL hole. */
  def findById(panelId: PanelId, callerOpt: Option[AuthenticatedUser]): Future[Option[Panel]] =
    panelRepo.findById(panelId, callerOpt)

  /** Resolve cross-user typeId bindings for a list of panels. If a panel's
   *  typeId belongs to a different user, it is cleared (treated as unbound).
   *
   *  Used by both `PanelService.update` (single panel, single user) and
   *  `PublicDashboardRoutes` (vector of panels, optional viewer) — closes the
   *  CS2a spinoff that asked for a unified resolver. */
  def resolveBindingsForRead(
      panels: Vector[Panel],
      userOpt: Option[AuthenticatedUser]
  ): Future[Vector[Panel]] = userOpt match {
    case None =>
      Future.successful(panels.map(_.withBindingCleared))
    case Some(user) =>
      val typedIds = panels.flatMap(_.dataTypeId).distinct
      if (typedIds.isEmpty)
        Future.successful(panels)
      else
        dataTypeRepo.findByIdsOwned(typedIds, user).map { ownedMap =>
          panels.map { panel =>
            panel.dataTypeId match {
              case None         => panel
              case Some(typeId) => if (ownedMap.contains(typeId)) panel else panel.withBindingCleared
            }
          }
        }
  }

  /** Public method used by routes that already have a Panel + a user. */
  def resolveBinding(panel: Panel, user: AuthenticatedUser): Future[Panel] =
    resolveSingleBinding(panel, user)

  private def resolveSingleBinding(panel: Panel, user: AuthenticatedUser): Future[Panel] =
    panel.dataTypeId match {
      case None => Future.successful(panel)
      case Some(typeId) =>
        dataTypeRepo.findByIdOwned(typeId, user).map {
          case None    => panel.withBindingCleared
          case Some(_) => panel
        }
    }

  // ── Create ────────────────────────────────────────────────────────────────

  def create(
      request: CreatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Panel]] =
    validateCreatePanelRequest(request) match {
      case Left(error) =>
        Future.successful(Left(ServiceError.BadRequest(error)))
      case Right(dashboardId) =>
        accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(ResourceAccess.Viewer) =>
            Future.successful(Left(ServiceError.Forbidden()))
          case Right(_) =>
            resolveCreateConfig(request) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(createConfig) =>
                rejectCompanionBinding(dataTypeIdFromCreateConfig(createConfig), user).flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_) =>
                    val now = Instant.now()
                    val panel = buildNewPanel(
                      id           = PanelId(UUID.randomUUID().toString),
                      dashboardId  = dashboardId,
                      title        = RequestValidation.normalizePanelTitle(request.title),
                      meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
                      appearance   = PanelAppearance.Default,
                      ownerId      = user.id,
                      createConfig = createConfig
                    )
                    panelRepo.insert(panel).map(Right(_))
                }
            }
        }
    }

  // ── Delete / duplicate ────────────────────────────────────────────────────

  def delete(panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    panelRepo.findByIdInternal(panelId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(panel) =>
        authorizeEditorOnDashboard(panel.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            panelRepo.delete(panelId).map {
              case true  => Right(())
              case false => Left(ServiceError.NotFound("Panel not found"))
            }
        }
    }

  def duplicate(panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, Panel]] =
    panelRepo.findByIdInternal(panelId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(panel) =>
        authorizeEditorOnDashboard(panel.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            panelRepo.duplicate(panelId, user.id).map {
              case Some(p) => Right(p)
              case None    => Left(ServiceError.NotFound("Panel not found"))
            }
        }
    }

  // ── Batch update ──────────────────────────────────────────────────────────

  /** Batch update panels. ACL is enforced via `accessChecker.requireAccess`
   *  on the parent dashboard — the authoritative gate. Per-panel owner checks
   *  are replaced by the dashboard-level check; `findByIdInternal` is used
   *  because the dashboard ACL is already the security boundary here. */
  def batchUpdate(
      items: Vector[PanelBatchItem],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[Panel]]] = {
    if (items.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("panels must not be empty")))
    else
      Future.traverse(items)(item => panelRepo.findByIdInternal(PanelId(item.id))).flatMap { panelOpts =>
        items.zip(panelOpts).collectFirst { case (item, None) => item.id } match {
          case Some(id) =>
            Future.successful(Left(ServiceError.NotFound(s"Panel '$id' not found")))
          case None =>
            val panels = panelOpts.flatten
            // Verify all panels share the same dashboard (required for batch
            // dashboard-ACL check) and that the caller has editor access.
            val dashboardIds = panels.map(_.dashboardId).distinct
            if (dashboardIds.size != 1) {
              Future.successful(Left(ServiceError.BadRequest("all panels in a batch must belong to the same dashboard")))
            } else {
              val dashboardId = dashboardIds.head
              accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").flatMap {
                case Left(err) =>
                  Future.successful(Left(err))
                case Right(ResourceAccess.Viewer) =>
                  Future.successful(Left(ServiceError.Forbidden()))
                case Right(_) =>
                  validateBatchTypeMatch(items.zip(panels)) match {
                    case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
                    case Right(_) =>
                      val now = Instant.now()
                      panelRepo.batchUpdate(items, now)
                        .map(updated => Right(updated))
                        .recover { case ex => Left(ServiceError.BadRequest(ex.getMessage)) }
                  }
              }
            }
        }
      }
  }

  // ── Patch ─────────────────────────────────────────────────────────────────

  def update(
      panelId: PanelId,
      request: UpdatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Panel]] =
    panelRepo.findByIdInternal(panelId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(existing) =>
        authorizeEditorOnDashboard(existing.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            resolvePatch(request, existing) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(spec) =>
                val incomingDataTypeId = spec.configPatch.flatMap(dataTypeIdFromConfigPatch)
                rejectCompanionBinding(incomingDataTypeId, user).flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_) =>
                    patchApplier.apply(panelId, spec, p => resolveSingleBinding(p, user))
                      .map {
                        case Some(panel) => Right(panel)
                        case None        => Left(ServiceError.NotFound("Panel not found"))
                      }
                      .recover { case ex: IllegalArgumentException => Left(ServiceError.BadRequest(ex.getMessage)) }
                }
            }
        }
    }

  // ── Internal: reject companion-DataType bindings (enforce-pipeline-only-bindings) ──

  /** 400 when `dataTypeIdOpt` resolves to a companion DataType (`sourceId`
   *  defined) — panels may only bind to pipeline-output types. A `None`
   *  input (no binding attempted) or a type that doesn't resolve for this
   *  owner (nonexistent / cross-user) both pass through unchanged: the
   *  latter preserves the existing silent-unbind-on-read behavior instead
   *  of turning it into a 400. */
  private def rejectCompanionBinding(
      dataTypeIdOpt: Option[DataTypeId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    dataTypeIdOpt match {
      case None => Future.successful(Right(()))
      case Some(dataTypeId) =>
        dataTypeRepo.findByIdOwned(dataTypeId, user).map {
          case Some(dt) if dt.sourceId.isDefined =>
            Left(ServiceError.BadRequest("Panels can only bind to pipeline-output data types"))
          case _ => Right(())
        }
    }

  // ── Internal: authorize as editor on the parent dashboard ─────────────────

  private def authorizeEditorOnDashboard(
      dashboardId: DashboardId,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
      case Left(err)                                                       => Left(err)
      case Right(ResourceAccess.Viewer)                                    => Left(ServiceError.Forbidden())
      case Right(ResourceAccess.Owner) | Right(ResourceAccess.Editor)     => Right(())
    }
}
