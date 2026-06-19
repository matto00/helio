package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{DashboardSnapshotPayload, UpdateDashboardRequest}
import com.helio.domain._
import com.helio.infrastructure.DashboardRepository
import com.helio.services.DashboardServiceValidation._

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

  def findAll(user: AuthenticatedUser, page: Page): Future[PagedResult[Dashboard]] =
    dashboardRepo.findAll(user.id, page)

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
   *  Forwarding def — keeps the external call path `DashboardService.validateSnapshotPayload`
   *  stable for tests while the implementation lives in [[DashboardServiceValidation]]. */
  def validateSnapshotPayload(payload: DashboardSnapshotPayload): Either[String, Unit] =
    DashboardServiceValidation.validateSnapshotPayload(payload)
}
