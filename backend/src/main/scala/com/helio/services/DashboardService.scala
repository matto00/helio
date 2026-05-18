package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{
  DashboardAppearancePayload,
  DashboardLayoutItemPayload,
  DashboardLayoutPayload,
  DashboardSnapshotPanelEntry,
  DashboardSnapshotPayload,
  UpdateDashboardRequest
}
import com.helio.domain._
import com.helio.domain.panels.PanelConfigCodec
import com.helio.infrastructure.DashboardRepository

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/dashboards` CRUD plus snapshot export / import.
 *
 *  Each method returns `Future[Either[ServiceError, A]]`. The HTTP route layer
 *  uses `ServiceResponse.run` to map errors to status codes; the service itself
 *  is Pekko-HTTP-free.
 *
 *  ACL strategy (CS4):
 *
 *  `delete` / `duplicate` — owner-only. Steps:
 *    1. `findById(sharing-aware)` → None = 404 (no existence leak for no-grant users)
 *    2. ownerId != user.id (grantee visible but not owner) → 403
 *    3. owner → proceed
 *
 *  `update` / `exportSnapshot` — sharing-aware with viewer guard. Steps:
 *    1. `findById(sharing-aware)` → None = 404
 *    2. owner → proceed
 *    3. grantee → check role via `accessChecker.requireAccess` → Viewer = 403
 */
final class DashboardService(
    dashboardRepo: DashboardRepository,
    accessChecker: AccessChecker
)(implicit ec: ExecutionContext) {

  import DashboardService._

  // ── CRUD ──────────────────────────────────────────────────────────────────

  def findAll(user: AuthenticatedUser): Future[Vector[Dashboard]] =
    dashboardRepo.findAll(user.id)

  def create(request: CreateDashboardInput, user: AuthenticatedUser): Future[Dashboard] = {
    val now = Instant.now()
    val dashboard = Dashboard(
      id         = DashboardId(UUID.randomUUID().toString),
      name       = RequestValidation.normalizeDashboardName(request.name),
      meta       = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = user.id
    )
    dashboardRepo.insert(dashboard)
  }

  /** Owner-only delete.
   *  - No access (no grant) → 404 (no existence leak)
   *  - Grantee visible but not owner → 403
   *  - Owner → 204 */
  def delete(dashboardId: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    dashboardRepo.findById(dashboardId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
      case Some(d) if d.ownerId != user.id =>
        Future.successful(Left(ServiceError.Forbidden()))
      case Some(_) =>
        dashboardRepo.delete(dashboardId).map {
          case true  => Right(())
          case false => Left(ServiceError.NotFound("Dashboard not found"))
        }
    }

  /** Owner-only duplicate.
   *  - No access → 404
   *  - Grantee → 403
   *  - Owner → 201 */
  def duplicate(
      dashboardId: DashboardId,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    dashboardRepo.findById(dashboardId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
      case Some(d) if d.ownerId != user.id =>
        Future.successful(Left(ServiceError.Forbidden()))
      case Some(_) =>
        dashboardRepo.duplicate(dashboardId, user.id).map {
          case None        => Left(ServiceError.NotFound("Dashboard not found"))
          case Some(value) => Right(value)
        }
    }

  /** Sharing-aware PATCH. Owner and editor grantees may update.
   *  - No access → 404
   *  - Owner → proceed
   *  - Grantee: role check via `accessChecker.requireAccess` → Viewer = 403, Editor = proceed */
  def update(
      dashboardId: DashboardId,
      request: UpdateDashboardRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Dashboard]] =
    validateDashboardUpdateRequest(request) match {
      case Left(error) =>
        Future.successful(Left(ServiceError.BadRequest(error)))
      case Right((nameOpt, appearanceOpt, layoutOpt)) =>
        dashboardRepo.findById(dashboardId, Some(user)).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
          case Some(existing) if existing.ownerId == user.id =>
            applyUpdate(dashboardId, existing, nameOpt, appearanceOpt, layoutOpt)
          case Some(existing) =>
            // Non-owner grantee: check role before allowing mutation.
            accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").flatMap {
              case Left(err)                        => Future.successful(Left(err))
              case Right(ResourceAccess.Viewer)     => Future.successful(Left(ServiceError.Forbidden()))
              case Right(_)                         => applyUpdate(dashboardId, existing, nameOpt, appearanceOpt, layoutOpt)
            }
        }
    }

  private def applyUpdate(
      dashboardId: DashboardId,
      existing: Dashboard,
      nameOpt: Option[String],
      appearanceOpt: Option[DashboardAppearance],
      layoutOpt: Option[DashboardLayout]
  ): Future[Either[ServiceError, Dashboard]] = {
    val now = Instant.now()
    nameOpt match {
      case Some(name) =>
        dashboardRepo.updateName(dashboardId, name, now).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
          case Some(renamed) =>
            if (appearanceOpt.isEmpty && layoutOpt.isEmpty) {
              Future.successful(Right(renamed))
            } else {
              val updated = renamed.copy(
                appearance = appearanceOpt.getOrElse(renamed.appearance),
                layout     = layoutOpt.getOrElse(renamed.layout),
                meta       = renamed.meta.copy(lastUpdated = now)
              )
              dashboardRepo.update(updated).map {
                case Some(d) => Right(d)
                case None    => Left(ServiceError.NotFound("Dashboard not found"))
              }
            }
        }
      case None =>
        val updated = existing.copy(
          appearance = appearanceOpt.getOrElse(existing.appearance),
          layout     = layoutOpt.getOrElse(existing.layout),
          meta       = existing.meta.copy(lastUpdated = now)
        )
        dashboardRepo.update(updated).map {
          case Some(d) => Right(d)
          case None    => Left(ServiceError.NotFound("Dashboard not found"))
        }
    }
  }

  // ── Snapshot export / import ──────────────────────────────────────────────

  /** Sharing-aware export. Owner and editor grantees may export.
   *  - No access → 404
   *  - Owner → proceed
   *  - Grantee: role check → Viewer = 403, Editor = proceed */
  def exportSnapshot(
      dashboardId: DashboardId,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, DashboardSnapshotPayload]] =
    dashboardRepo.findById(dashboardId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
      case Some(d) if d.ownerId == user.id =>
        dashboardRepo.exportSnapshot(dashboardId).map {
          case None        => Left(ServiceError.NotFound("Dashboard not found"))
          case Some(value) => Right(value)
        }
      case Some(_) =>
        // Non-owner grantee: check role.
        accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").flatMap {
          case Left(err)                    => Future.successful(Left(err))
          case Right(ResourceAccess.Viewer) => Future.successful(Left(ServiceError.Forbidden()))
          case Right(_) =>
            dashboardRepo.exportSnapshot(dashboardId).map {
              case None        => Left(ServiceError.NotFound("Dashboard not found"))
              case Some(value) => Right(value)
            }
        }
    }

  def importSnapshot(
      payload: DashboardSnapshotPayload,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    validateSnapshotPayload(payload) match {
      case Left(error) =>
        Future.successful(Left(ServiceError.BadRequest(error)))
      case Right(_) =>
        dashboardRepo.importSnapshot(payload, user.id).map(Right(_))
    }
}

object DashboardService {

  /** Inputs accepted by `create`. A small wrapper instead of leaking the
   *  protocol-level `CreateDashboardRequest` to keep the service signature
   *  independent of the HTTP protocol types. */
  final case class CreateDashboardInput(name: Option[String])

  /** Validate a snapshot payload at import time.
   *  Exposed via the companion for direct unit-test access. */
  def validateSnapshotPayload(payload: DashboardSnapshotPayload): Either[String, Unit] =
    for {
      _ <- validateVersion(payload.version)
      _ <- validateName(payload.dashboard.name)
      _ <- validatePanelEntries(payload.panels)
      _ <- validateLayoutReferences(payload)
    } yield ()

  /** CS2c-3c: prior versions are rejected (design.md D3) because the prior
   *  wire shape silently dropped Image / Divider config fields — a snapshot
   *  exported pre-fix cannot be losslessly imported anyway. */
  private[services] def validateVersion(version: Int): Either[String, Unit] =
    if (version == DashboardSnapshotPayload.CurrentVersion) Right(())
    else
      Left(
        s"snapshot version $version is no longer supported (current version: ${DashboardSnapshotPayload.CurrentVersion}); " +
          "please re-export the dashboard from the current app version"
      )

  private[services] def validateName(name: String): Either[String, Unit] =
    if (name.trim.isEmpty) Left("dashboard.name must not be blank")
    else Right(())

  /** Validate each entry's `type` against the registry AND its `config`
   *  against the per-subtype decoder (catches type/config shape mismatch
   *  before the importer reaches the repository). */
  private[services] def validatePanelEntries(panels: Vector[DashboardSnapshotPanelEntry]): Either[String, Unit] =
    panels.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), entry) =>
        PanelType.fromString(entry.`type`).flatMap { _ =>
          PanelConfigCodec.decodeCreateConfig(entry.`type`, Some(entry.config))
            .left.map(msg => s"panel '${entry.snapshotId}': $msg")
            .map(_ => ())
        }
    }

  private[services] def validateLayoutReferences(payload: DashboardSnapshotPayload): Either[String, Unit] = {
    val snapshotIds = payload.panels.map(_.snapshotId).toSet
    val allLayoutItems =
      payload.dashboard.layout.lg ++
        payload.dashboard.layout.md ++
        payload.dashboard.layout.sm ++
        payload.dashboard.layout.xs

    allLayoutItems.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), item) =>
        if (snapshotIds.contains(item.panelId)) Right(())
        else Left(s"layout references unknown snapshotId: '${item.panelId}'")
    }
  }

  /** Validate + normalize a dashboard PATCH payload. Returns the trimmed
   *  name (if any), normalized appearance (if any), and validated layout
   *  (if any). */
  private[services] def validateDashboardUpdateRequest(
      request: UpdateDashboardRequest
  ): Either[String, (Option[String], Option[DashboardAppearance], Option[DashboardLayout])] = {
    if (request.name.isEmpty && request.appearance.isEmpty && request.layout.isEmpty) {
      Left("name, appearance, or layout is required")
    } else {
      request.name.map(_.trim) match {
        case Some("") => Left("name must not be blank")
        case nameOpt =>
          validateDashboardLayoutPayload(request.layout).map { layout =>
            (
              nameOpt,
              request.appearance.map(normalizeAppearance),
              layout
            )
          }
      }
    }
  }

  private def normalizeAppearance(p: DashboardAppearancePayload): DashboardAppearance =
    DashboardAppearance(
      background     = RequestValidation.normalizeDashboardBackground(p.background),
      gridBackground = RequestValidation.normalizeDashboardGridBackground(p.gridBackground)
    )

  private def validateDashboardLayoutPayload(
      layout: Option[DashboardLayoutPayload]
  ): Either[String, Option[DashboardLayout]] =
    layout match {
      case None => Right(None)
      case Some(p) =>
        for {
          lg <- validateDashboardLayoutItems(p.lg)
          md <- validateDashboardLayoutItems(p.md)
          sm <- validateDashboardLayoutItems(p.sm)
          xs <- validateDashboardLayoutItems(p.xs)
        } yield Some(DashboardLayout(lg, md, sm, xs))
    }

  private def validateDashboardLayoutItems(
      items: Vector[DashboardLayoutItemPayload]
  ): Either[String, Vector[DashboardLayoutItem]] =
    items.foldLeft[Either[String, Vector[DashboardLayoutItem]]](Right(Vector.empty)) {
      case (Left(err), _) => Left(err)
      case (Right(acc), item) =>
        val panelId = item.panelId.trim
        if (panelId.isEmpty) Left("layout panelId is required")
        else Right(acc :+ DashboardLayoutItem(
          panelId = PanelId(panelId),
          x       = RequestValidation.normalizeLayoutCoordinate(item.x),
          y       = RequestValidation.normalizeLayoutCoordinate(item.y),
          w       = RequestValidation.normalizeLayoutSpan(item.w),
          h       = RequestValidation.normalizeLayoutSpan(item.h)
        ))
    }
}
