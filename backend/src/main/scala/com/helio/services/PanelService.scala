package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreatePanelRequest, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain._
import com.helio.infrastructure.{DataTypeRepository, PanelRepository}
import spray.json.JsValue

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** A pre-validated, normalized snapshot of an `UpdatePanelRequest`.
 *
 *  `typeIdUpdate` and `fieldMappingUpdate` preserve the `Option[Option[_]]` wire
 *  semantics from the request:
 *    - outer `None`        — field absent (no change)
 *    - `Some(None)`        — explicit JSON `null` (clear binding)
 *    - `Some(Some(value))` — set to `value`
 *
 *  The custom Spray formatter in `PanelProtocol` produces this shape directly,
 *  so the apply chain threads it through unchanged. */
final case class ResolvedPanelPatch(
    trimmedTitle:       Option[String],
    appearance:         Option[PanelAppearance],
    panelType:          Option[PanelType],
    typeIdUpdate:       Option[Option[DataTypeId]],
    fieldMappingUpdate: Option[Option[JsValue]],
    content:            Option[String],
    hasContent:         Boolean,
    imageUrl:           Option[String],
    imageFit:           Option[String],
    hasImage:           Boolean,
    dividerOrientation: Option[String],
    dividerWeight:      Option[Int],
    dividerColor:       Option[String],
    hasDivider:         Boolean
)

/** Business logic for `/api/panels`. Absorbs the prior `PanelPatchService` so
 *  the patch resolver + step-by-step applier live with the rest of panel CRUD.
 *
 *  Resource-level ACL is delegated to [[AccessChecker]] using the parent
 *  dashboard's permissions (panels inherit access from their dashboard).
 *  `findById` performs no ACL check — same as pre-CS2b. */
final class PanelService(
    panelRepo:     PanelRepository,
    dataTypeRepo:  DataTypeRepository,
    accessChecker: AccessChecker
)(implicit ec: ExecutionContext) {

  private val patchApplier = new PanelPatchApplier(panelRepo)

  // ── Read ──────────────────────────────────────────────────────────────────

  def findById(panelId: PanelId): Future[Option[Panel]] =
    panelRepo.findById(panelId)

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
      Future.successful(panels.map(p => p.copy(typeId = None, fieldMapping = None)))
  }

  /** Public method used by routes that already have a Panel + a user. */
  def resolveBinding(panel: Panel, user: AuthenticatedUser): Future[Panel] =
    resolveSingleBinding(panel, user)

  private def resolveSingleBinding(panel: Panel, user: AuthenticatedUser): Future[Panel] =
    panel.typeId match {
      case None => Future.successful(panel)
      case Some(typeId) =>
        dataTypeRepo.findById(typeId, user.id).map {
          case None    => panel.copy(typeId = None, fieldMapping = None)
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
            PanelService.validatePanelType(request.`type`) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(panelType) =>
                val now = Instant.now()
                val panel = Panel(
                  id          = PanelId(UUID.randomUUID().toString),
                  dashboardId = dashboardId,
                  title       = RequestValidation.normalizePanelTitle(request.title),
                  meta        = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
                  appearance  = PanelAppearance.Default,
                  panelType   = panelType,
                  ownerId     = user.id,
                  content     = request.content,
                  typeId      = request.dataTypeId.map(DataTypeId(_))
                )
                panelRepo.insert(panel).map(Right(_))
            }
        }
    }

  // ── Delete / duplicate ────────────────────────────────────────────────────

  def delete(panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    panelRepo.findById(panelId).flatMap {
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
    panelRepo.findById(panelId).flatMap {
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

  def batchUpdate(
      items: Vector[PanelBatchItem],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[Panel]]] = {
    if (items.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("panels must not be empty")))
    else
      Future.traverse(items)(item => panelRepo.findById(PanelId(item.id))).flatMap { panelOpts =>
        items.zip(panelOpts).collectFirst { case (item, None) => item.id } match {
          case Some(id) =>
            Future.successful(Left(ServiceError.NotFound(s"Panel '$id' not found")))
          case None =>
            val panels = panelOpts.flatten
            panels.find(_.ownerId != user.id) match {
              case Some(_) =>
                Future.successful(Left(ServiceError.Forbidden()))
              case None =>
                val now = Instant.now()
                panelRepo.batchUpdate(items, now)
                  .map(updated => Right(updated))
                  .recover { case ex => Left(ServiceError.BadRequest(ex.getMessage)) }
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
    panelRepo.findById(panelId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(existing) =>
        authorizeEditorOnDashboard(existing.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            PanelService.resolvePatch(request) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(spec) =>
                patchApplier.apply(panelId, spec, p => resolveSingleBinding(p, user)).map {
                  case Some(panel) => Right(panel)
                  case None        => Left(ServiceError.NotFound("Panel not found"))
                }
            }
        }
    }

  // ── Internal: authorize as editor on the parent dashboard ─────────────────

  private def authorizeEditorOnDashboard(
      dashboardId: DashboardId,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
      case Left(err)                          => Left(err)
      case Right(ResourceAccess.Viewer)       => Left(ServiceError.Forbidden())
      case Right(ResourceAccess.Owner) | Right(ResourceAccess.Editor) => Right(())
    }

}

object PanelService {

  /** Validate + normalize an `UpdatePanelRequest`. The `Option[Option[_]]`
   *  wire semantics for `typeId` and `fieldMapping` are preserved by
   *  `ResolvedPanelPatch`. */
  def resolvePatch(request: UpdatePanelRequest): Either[String, ResolvedPanelPatch] = {
    val trimmedTitle  = request.title.map(_.trim)
    val hasBinding    = request.typeId.isDefined || request.fieldMapping.isDefined
    val hasContent    = request.content.isDefined
    val hasImage      = request.imageUrl.isDefined || request.imageFit.isDefined
    val hasDivider    = request.dividerOrientation.isDefined || request.dividerWeight.isDefined || request.dividerColor.isDefined
    val hasOtherField = trimmedTitle.isDefined || request.appearance.isDefined || request.`type`.isDefined || hasContent

    for {
      _            <- if (trimmedTitle.contains("")) Left("title must not be blank") else Right(())
      _            <- if (hasOtherField || hasBinding || hasImage || hasDivider) Right(())
                      else Left("at least one field is required")
      _            <- RequestValidation.validateImageFit(request.imageFit)
      _            <- RequestValidation.validateDividerOrientation(request.dividerOrientation)
      panelTypeOpt <- validatePanelTypeOpt(request.`type`)
    } yield ResolvedPanelPatch(
      trimmedTitle       = trimmedTitle,
      appearance         = request.appearance.map(p =>
                             PanelAppearance(
                               background   = RequestValidation.normalizePanelBackground(p.background),
                               color        = RequestValidation.normalizePanelColor(p.color),
                               transparency = RequestValidation.normalizeTransparency(p.transparency),
                               chart        = p.chart
                             )
                           ),
      panelType          = panelTypeOpt,
      typeIdUpdate       = request.typeId.map(_.map(DataTypeId(_))),
      fieldMappingUpdate = request.fieldMapping,
      content            = request.content,
      hasContent         = hasContent,
      imageUrl           = request.imageUrl,
      imageFit           = request.imageFit,
      hasImage           = hasImage,
      dividerOrientation = request.dividerOrientation,
      dividerWeight      = request.dividerWeight,
      dividerColor       = request.dividerColor,
      hasDivider         = hasDivider
    )
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
