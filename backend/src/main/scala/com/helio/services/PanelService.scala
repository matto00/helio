package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreatePanelRequest, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure.{DataTypeRepository, PanelRepository}
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
    case Some(user) =>
      Future.traverse(panels)(p => resolveSingleBinding(p, user))
    case None =>
      Future.successful(panels.map(_.withBindingCleared))
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
    PanelService.validateCreatePanelRequest(request) match {
      case Left(error) =>
        Future.successful(Left(ServiceError.BadRequest(error)))
      case Right(dashboardId) =>
        accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(ResourceAccess.Viewer) =>
            Future.successful(Left(ServiceError.Forbidden()))
          case Right(_) =>
            PanelService.resolveCreateConfig(request) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(createConfig) =>
                val now = Instant.now()
                val panel = PanelService.buildNewPanel(
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
                  PanelService.validateBatchTypeMatch(items.zip(panels)) match {
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
            PanelService.resolvePatch(request, existing) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(spec) =>
                patchApplier.apply(panelId, spec, p => resolveSingleBinding(p, user))
                  .map {
                    case Some(panel) => Right(panel)
                    case None        => Left(ServiceError.NotFound("Panel not found"))
                  }
                  .recover { case ex: IllegalArgumentException => Left(ServiceError.BadRequest(ex.getMessage)) }
            }
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

object PanelService {

  /** Validate + normalize an `UpdatePanelRequest`. The `config` patch JsValue
   *  is preserved as-is and decoded against the stored panel's typed shape
   *  at apply-time (via [[PanelConfigCodec.applyConfigPatch]]).
   *
   *  Cross-type PATCH lock: if the request carries an explicit `type` that
   *  differs from the stored panel's `kind`, return 400 here. */
  def resolvePatch(request: UpdatePanelRequest, existing: Panel): Either[String, ResolvedPanelPatch] = {
    val trimmedTitle = request.title.map(_.trim)
    for {
      _            <- if (trimmedTitle.contains("")) Left("title must not be blank") else Right(())
      panelTypeOpt <- validatePanelTypeOpt(request.`type`)
      _            <- panelTypeOpt match {
                        case Some(pt) if PanelType.asString(pt) != existing.kind =>
                          Left(s"cannot change panel type: stored type is '${existing.kind}', request type is '${PanelType.asString(pt)}'")
                        case _ => Right(())
                      }
      resolved = ResolvedPanelPatch(
                   trimmedTitle = trimmedTitle,
                   appearance   = request.appearance.map(p =>
                                    PanelAppearance(
                                      background   = RequestValidation.normalizePanelBackground(p.background),
                                      color        = RequestValidation.normalizePanelColor(p.color),
                                      transparency = RequestValidation.normalizeTransparency(p.transparency),
                                      chart        = p.chart
                                    )
                                  ),
                   panelType    = panelTypeOpt,
                   configPatch  = request.config
                 )
      _ <- if (resolved.hasAnyField) Right(()) else Left("at least one field is required")
    } yield resolved
  }

  /** Decode the create-side typed config from the request. Discriminator is
   *  required; an absent or empty `config` falls back to the subtype's
   *  `Empty` defaults (codec read-path tolerance rule). */
  private[services] def resolveCreateConfig(request: CreatePanelRequest): Either[String, PanelConfigCodec.CreateConfig] =
    validatePanelType(request.`type`).flatMap { pt =>
      PanelConfigCodec.decodeCreateConfig(PanelType.asString(pt), request.config)
    }

  /** Cross-type batch lock: every entry's request `type` (when present) must
   *  match the stored panel's `kind`. */
  private[services] def validateBatchTypeMatch(
      pairs: Vector[(PanelBatchItem, Panel)]
  ): Either[String, Unit] =
    pairs.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), (item, panel)) =>
        item.`type` match {
          case Some(t) if t != panel.kind =>
            Left(s"cannot change panel type for '${item.id}': stored type is '${panel.kind}', request type is '$t'")
          case _ => Right(())
        }
    }

  /** Construct a brand-new `Panel` from the decoded typed create-config. */
  private[services] def buildNewPanel(
      id: PanelId,
      dashboardId: DashboardId,
      title: String,
      meta: ResourceMeta,
      appearance: PanelAppearance,
      ownerId: UserId,
      createConfig: PanelConfigCodec.CreateConfig
  ): Panel = createConfig match {
    case PanelConfigCodec.MetricCreate(c)   => MetricPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.ChartCreate(c)    => ChartPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.TableCreate(c)    => TablePanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.TextCreate(c)     => TextPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.MarkdownCreate(c) => MarkdownPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.ImageCreate(c)    => ImagePanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.DividerCreate(c)  => DividerPanel(id, dashboardId, title, meta, appearance, ownerId, c)
  }

  private[services] def validateCreatePanelRequest(request: CreatePanelRequest): Either[String, DashboardId] =
    request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
      case Some(id) => Right(DashboardId(id))
      case None     => Left("dashboardId is required")
    }

  private[services] def validatePanelType(typeOpt: Option[String]): Either[String, PanelType] =
    typeOpt match {
      case None    => Right(PanelType.Default)
      case Some(t) => PanelType.fromString(t)
    }

  private def validatePanelTypeOpt(typeOpt: Option[String]): Either[String, Option[PanelType]] =
    typeOpt match {
      case None    => Right(None)
      case Some(t) => PanelType.fromString(t).map(Some(_))
    }
}
