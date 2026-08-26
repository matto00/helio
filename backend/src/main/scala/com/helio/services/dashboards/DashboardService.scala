package com.helio.services.dashboards

import com.helio.services.auth.AccessChecker
import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.dashboards.{DashboardSnapshotPayload, UpdateDashboardRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.services.dashboards.DashboardServiceValidation._
import spray.json._

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
    accessChecker: AccessChecker,
    // HEL-477: nullable-optional wiring mirrors the file's other collaborators
    // (see design.md Decision 3) — `null` in a fixture that never asserts on
    // audit rows behaves as "audit disabled", never a NullPointerException,
    // since every call site below guards on it via `audit(...)`.
    auditService: AuditService = null
)(implicit ec: ExecutionContext) {

  import DashboardService._

  /** Fire-and-forget audit call — a no-op when `auditService` is `null`
   *  (fixtures that don't pass one). HEL-483: `source`/`actor_token_id` come
   *  from the caller's resolved credential via `AuthenticatedUser`. */
  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser, metadata: JsValue = JsObject.empty): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, "dashboard", resourceId, metadata)

  // ── CRUD ──────────────────────────────────────────────────────────────────

  def findAll(user: AuthenticatedUser, page: Page): Future[PagedResult[Dashboard]] =
    dashboardRepo.findAll(user.id, page)

  /** Owner-scoped single-resource read (HEL-661 design.md D3), mirroring `DataTypeService.findById`'s
   *  exact shape over `DashboardRepository.findByIdOwned` — deliberately NOT the sharing-aware
   *  `findById(id, Some(user))` this service's own mutation paths above use; `WorkspaceSearchService.
   *  getResource` needs an owner-only lookup, matching its consistent owner-only contract across
   *  every resource type (design.md D1b). */
  def findById(id: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, Dashboard]] =
    dashboardRepo.findByIdOwned(id, user).map {
      case Some(d) => Right(d)
      case None    => Left(ServiceError.NotFound("Dashboard not found"))
    }

  /** Create a dashboard, or — when `request.ifExists = Some("return")`
   *  (HEL-363 D3) — return an existing same-owner, case-insensitive/trimmed
   *  name match instead of creating a duplicate. Returns `(dashboard,
   *  created)`: `created = true` for a fresh insert (route → 201), `false`
   *  for a returned existing match (route → 200).
   *
   *  App-level check-then-insert, no DB uniqueness constraint (design.md D3):
   *  when `ifExists` is absent this performs NO lookup at all — byte-for-byte
   *  the same single insert as before this change, no new failure mode. The
   *  lookup-then-insert is NOT atomic (no constraint backs it) — two
   *  concurrent calls that both miss an existing match can both insert,
   *  yielding two same-named dashboards; accepted for v1 (design.md D4),
   *  since `helio-news`'s real usage is one serial call per rebuild. */
  def create(request: CreateDashboardInput, user: AuthenticatedUser): Future[(Dashboard, Boolean)] = {
    val name = RequestValidation.normalizeDashboardName(request.name)
    val resultF: Future[(Dashboard, Boolean)] = request.ifExists match {
      case Some("return") =>
        dashboardRepo.findByNameOwned(name, user.id).flatMap {
          case Some(existing) => Future.successful((existing, false))
          case None           => insertNew(name, user).map((_, true))
        }
      case _ =>
        insertNew(name, user).map((_, true))
    }
    resultF.map { case (dashboard, created) =>
      // HEL-477 design.md Decision 2: only the fresh-insert branch (`created
      // = true`) fires the audit call — a `(existing, false)` return created
      // nothing, so there is nothing to audit.
      if (created) audit("dashboard.create", Some(dashboard.id.value), user)
      (dashboard, created)
    }
  }

  private def insertNew(name: String, user: AuthenticatedUser): Future[Dashboard] = {
    val now = Instant.now()
    val dashboard = Dashboard(
      id         = DashboardId(UUID.randomUUID().toString),
      name       = name,
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
    deleteInternal(dashboardId, user).map {
      case r @ Right(_) =>
        // HEL-477: DB-level cascade deletes the dashboard's panels — no
        // separate panel.delete rows are emitted for those (design.md
        // Decision 7); only this one dashboard.delete call is recorded.
        audit("dashboard.delete", Some(dashboardId.value), user)
        r
      case l => l
    }

  /** HEL-477 design.md Decision 10 — identical logic to the public [[delete]]
   *  above, but NEVER calls `AuditService.record`. Rollback-only: do not call
   *  from a route. `DashboardProposalService.createAll`'s rollback branch
   *  uses this instead of the public `delete` so a failed proposal apply
   *  doesn't write a false `dashboard.delete` for a dashboard that, from the
   *  caller's perspective, never came into existence (a failed mutation
   *  never claims to have happened — Decision 2). */
  private[services] def deleteInternal(dashboardId: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
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
          case Some(value @ (newDashboard, _)) =>
            // HEL-477 design.md Decision 7: exactly one dashboard.duplicate
            // row — the copied panels do NOT each additionally emit
            // panel.create.
            audit(
              "dashboard.duplicate",
              Some(newDashboard.id.value),
              user,
              JsObject("sourceDashboardId" -> JsString(dashboardId.value))
            )
            Right(value)
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
  ): Future[Either[ServiceError, Dashboard]] = {
    val resultF: Future[Either[ServiceError, Dashboard]] = validateDashboardUpdateRequest(request) match {
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
    resultF.map {
      case r @ Right(_) =>
        audit("dashboard.update", Some(dashboardId.value), user)
        r
      case l => l
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
        dashboardRepo.importSnapshot(payload, user.id).map { case value @ (dashboard, panels) =>
          // HEL-477 design.md Decision 9: a distinct dashboard.import action
          // (not dashboard.create) — one row, no per-panel events.
          audit(
            "dashboard.import",
            Some(dashboard.id.value),
            user,
            JsObject("panelCount" -> JsNumber(panels.size))
          )
          Right(value)
        }
    }
}

object DashboardService {

  /** Inputs accepted by `create`. A small wrapper instead of leaking the
   *  protocol-level `CreateDashboardRequest` to keep the service signature
   *  independent of the HTTP protocol types. `ifExists` defaults to `None`
   *  so every pre-HEL-363 positional call site (`CreateDashboardInput(name)`)
   *  keeps compiling unchanged. */
  final case class CreateDashboardInput(name: Option[String], ifExists: Option[String] = None)

  /** Validate a snapshot payload at import time.
   *  Forwarding def — keeps the external call path `DashboardService.validateSnapshotPayload`
   *  stable for tests while the implementation lives in [[DashboardServiceValidation]]. */
  def validateSnapshotPayload(payload: DashboardSnapshotPayload): Either[String, Unit] =
    DashboardServiceValidation.validateSnapshotPayload(payload)
}
