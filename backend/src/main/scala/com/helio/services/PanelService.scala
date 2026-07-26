package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreatePanelRequest, CreatePanelsBatchRequest, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain._
import com.helio.domain.panels._
import com.helio.infrastructure.{DashboardRepository, DataTypeRepository, PanelRepository}
import com.helio.services.PanelServiceHelpers._
import org.slf4j.LoggerFactory
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
 *    via `authorizeEditorOnDashboard`.
 *  - `batchCreate` (HEL-370) uses its own two-step `authorizeEditor`
 *    (sharing-aware `dashboardRepo.findById` first, role check only for
 *    known grantees) rather than `authorizeEditorOnDashboard` — design.md D4:
 *    the latter's bare `accessChecker.requireAccess` call 403s a cross-tenant
 *    caller instead of 404ing (an existence leak this ticket must not
 *    reopen). Mirrors `DashboardContentsService.authorizeEditor` exactly. */
final class PanelService(
    panelRepo:     PanelRepository,
    dataTypeRepo:  DataTypeRepository,
    accessChecker: AccessChecker,
    dashboardRepo: DashboardRepository
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

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
            buildForCreate(dashboardId, request, user).flatMap {
              case Left(err)    => Future.successful(Left(err))
              case Right(panel) => panelRepo.insert(panel).map(Right(_))
            }
        }
    }

  /** Construct + validate a new `Panel` domain object for `dashboardId` from a
   *  `CreatePanelRequest` — every check `create` performs EXCEPT the
   *  dashboard ACL check (the caller is expected to have already authorized
   *  the target dashboard) and the final `panelRepo.insert` write.
   *
   *  Extracted (HEL-363 D1, behavior-preserving — same validation order, same
   *  error messages as before) so `DashboardContentsService`'s atomic
   *  replace-contents path can validate + build every panel in a batch, with
   *  zero DB writes, before its single transactional write — reusing this
   *  exact config-decode/appearance-resolve/`rejectCompanionBinding` logic
   *  per panel instead of duplicating it. */
  private[services] def buildForCreate(
      dashboardId: DashboardId,
      request: CreatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Panel]] = {
    val resolved = for {
      createConfig <- resolveCreateConfig(request)
      appearance   <- resolveCreateAppearance(request.appearance)
    } yield (createConfig, appearance)
    resolved match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(err)))
      case Right((createConfig, appearance)) =>
        rejectCompanionBinding(dataTypeIdFromCreateConfig(createConfig), user).map {
          case Left(err) => Left(err)
          case Right(_) =>
            val now = Instant.now()
            Right(buildNewPanel(
              id           = PanelId(UUID.randomUUID().toString),
              dashboardId  = dashboardId,
              title        = RequestValidation.normalizePanelTitle(request.title),
              meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
              appearance   = appearance,
              ownerId      = user.id,
              createConfig = createConfig
            ))
        }
    }
  }

  /** Sequentially `buildForCreate` every request for `dashboardId`, short-
   *  circuiting on the first failure — zero DB writes for ANY item until every
   *  item in `requests` has been validated + constructed (design.md D1/D2).
   *
   *  Extracted so `DashboardContentsService.buildPanels` and `batchCreate`
   *  share one "validate every item before any write" recursion instead of
   *  each hand-rolling its own. `itemLabel` (default: no label) lets a caller
   *  opt into a per-index prefix on a `BadRequest` failure (e.g. `"panel 2
   *  ('Revenue'): ..."`) without changing the unlabeled caller's messages —
   *  `DashboardContentsService` passes the default so its own tested error
   *  messages stay byte-for-byte unchanged; `batchCreate` opts in (design.md
   *  D5) to satisfy this ticket's "400 identifies the offending item" AC.
   *  Only `BadRequest` errors are labeled — every other `ServiceError`
   *  `buildForCreate` can produce passes through unlabeled. */
  private[services] def buildAllForCreate(
      dashboardId: DashboardId,
      requests: Vector[CreatePanelRequest],
      user: AuthenticatedUser,
      itemLabel: Int => Option[String] = _ => None
  ): Future[Either[ServiceError, Vector[Panel]]] = {
    def loop(remaining: Vector[(CreatePanelRequest, Int)], acc: Vector[Panel]): Future[Either[ServiceError, Vector[Panel]]] =
      remaining.headOption match {
        case None => Future.successful(Right(acc))
        case Some((request, idx)) =>
          buildForCreate(dashboardId, request, user).flatMap {
            case Left(ServiceError.BadRequest(msg)) =>
              val labeled = itemLabel(idx).fold(msg)(label => s"$label: $msg")
              Future.successful(Left(ServiceError.BadRequest(labeled)))
            case Left(err)    => Future.successful(Left(err))
            case Right(built) => loop(remaining.tail, acc :+ built)
          }
      }
    loop(requests.zipWithIndex, Vector.empty)
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
                  // D5 — validate every item's chartType before the transactional
                  // write so an invalid value rejects the whole batch (no partial
                  // write). This is the path the live edit UI uses.
                  val batchValidation = for {
                    _ <- validateBatchTypeMatch(items.zip(panels))
                    _ <- validateBatchChartTypes(items)
                  } yield ()
                  batchValidation match {
                    case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
                    case Right(_) =>
                      val now = Instant.now()
                      panelRepo.batchUpdate(items, now)
                        .map(updated => Right(updated))
                        .recover { case ex =>
                          // HEL-311: never echo a raw DB-failure message; log
                          // the detail server-side and return a generic body.
                          log.error(s"batchUpdate failed for dashboard ${dashboardId.value}", ex)
                          Left(ServiceError.BadRequest("Batch update failed"))
                        }
                  }
              }
            }
        }
      }
  }

  // ── Batch create ──────────────────────────────────────────────────────────

  /** `POST /api/panels/batch` (HEL-370) — create N panels on ONE existing
   *  dashboard in a single transaction, all-or-nothing. Rejects an empty
   *  `panels` array (400, mirrors `batchUpdate`'s empty-batch guard), then
   *  ACL-checks `request.dashboardId` via the two-step `authorizeEditor`
   *  (design.md D4), then maps every item + the envelope `dashboardId` to a
   *  `CreatePanelRequest` and delegates validation + construction to
   *  `buildAllForCreate` with a labeled `itemLabel` (design.md D2/D5) so a
   *  bad item's 400 names it by 1-based index and title. Only on full success
   *  does `panelRepo.insertBatch` run — zero DB writes on any invalid item. */
  def batchCreate(
      request: CreatePanelsBatchRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[Panel]]] =
    if (request.panels.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("panels must not be empty")))
    else
      request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
        case None =>
          Future.successful(Left(ServiceError.BadRequest("dashboardId is required")))
        case Some(id) =>
          val dashboardId = DashboardId(id)
          authorizeEditor(dashboardId, user).flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_) =>
              val items = request.panels
              val createRequests = items.map { item =>
                CreatePanelRequest(
                  dashboardId = Some(dashboardId.value),
                  title       = item.title,
                  `type`      = item.`type`,
                  config      = item.config,
                  appearance  = item.appearance
                )
              }
              val itemLabel: Int => Option[String] =
                idx => Some(s"panel ${idx + 1} ('${items(idx).title.getOrElse("")}')")
              buildAllForCreate(dashboardId, createRequests, user, itemLabel).flatMap {
                case Left(err)     => Future.successful(Left(err))
                case Right(built)  => panelRepo.insertBatch(built).map(Right(_))
              }
          }
      }

  /** Owner or editor grantee may batch-create — mirrors
   *  `DashboardContentsService.authorizeEditor`'s exact two-step pattern (NOT
   *  a bare `accessChecker.requireAccess` call, which 403s ANY authenticated
   *  no-grant caller on an existing resource instead of 404ing — design.md
   *  D4, a known existence-leak class this ticket must not reopen). Step 1:
   *  the sharing-aware `dashboardRepo.findById` — `None` (no grant at all) →
   *  404, no existence leak. Step 2: only once the caller is a KNOWN grantee
   *  does role tier matter — owner proceeds directly; a non-owner grantee's
   *  role is checked via `accessChecker.requireAccess` (Viewer → 403, Editor
   *  → proceed). */
  private def authorizeEditor(dashboardId: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    dashboardRepo.findById(dashboardId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
      case Some(existing) if existing.ownerId == user.id =>
        Future.successful(Right(()))
      case Some(_) =>
        accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
          case Left(err)                    => Left(err)
          case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())
          case Right(_)                     => Right(())
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
