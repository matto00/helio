package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.audit.AuditService
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.panels.{CreatePanelRequest, CreatePanelsBatchRequest, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.services.panels.PanelServiceHelpers._
import org.slf4j.LoggerFactory
import spray.json._

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
    dashboardRepo: DashboardRepository,
    // HEL-500: appended last (rather than beside the other constructor
    // params) so it stays purely additive for every existing positional
    // caller of this constructor. Nullable-optional wiring is NOT used here
    // (unlike ApiRoutes's Option-guarded repos) — `metricRepo` is only ever
    // touched when a panel actually carries a `metricId`, so a test fixture
    // that never sets one never exercises it.
    metricRepo: MetricRepository,
    // HEL-477: nullable-optional wiring mirrors metricRepo above — a fixture
    // that doesn't pass one simply never audits (see `audit` below).
    auditService: AuditService = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val patchApplier = new PanelPatchApplier(panelRepo)

  /** Fire-and-forget audit call, a no-op when `auditService` is `null`.
   *  HEL-477 design.md Decision 3: `source` is always `AuditSource.Ui`. */
  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser, metadata: JsValue = JsObject.empty): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), None, AuditSource.Ui, action, "panel", resourceId, metadata)

  // ── Read ──────────────────────────────────────────────────────────────────

  /** Sharing-aware read. Returns the panel only when the caller has access
   *  to the parent dashboard (owner, grantee, or public viewer when
   *  `callerOpt = None`). Closes the `/api/panels/:id/query` ACL hole. */
  def findById(panelId: PanelId, callerOpt: Option[AuthenticatedUser]): Future[Option[Panel]] =
    panelRepo.findById(panelId, callerOpt)

  /** Resolve cross-user typeId/metricId bindings for a list of panels. If a
   *  panel's typeId belongs to a different user, its whole binding is
   *  cleared (treated as unbound, pre-existing behavior). If a panel's
   *  `metricId` (HEL-500) belongs to a different user or no longer exists,
   *  ONLY `metricId` is cleared — independently of `dataTypeId`/
   *  `fieldMapping` (design.md D3) — and, for a `MetricPanel` whose
   *  `metricId` DOES resolve, the effective binding is materialized from the
   *  resolved `MetricDefinition` (design.md D4).
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
      val typedIds  = panels.flatMap(_.dataTypeId).distinct
      val metricIds = panels.flatMap(metricIdOf).distinct
      for {
        ownedTypes <-
          if (typedIds.isEmpty) Future.successful(Map.empty[DataTypeId, DataType])
          else dataTypeRepo.findByIdsOwned(typedIds, user)
        ownedMetrics <-
          if (metricIds.isEmpty) Future.successful(Map.empty[MetricId, MetricDefinition])
          else metricRepo.findByIdsOwned(metricIds, user)
      } yield panels.map(resolveOne(_, ownedTypes, ownedMetrics))
  }

  /** Per-panel resolution shared by `resolveBindingsForRead`'s batch path:
   *  clear the whole binding when `dataTypeId` doesn't resolve (pre-existing
   *  behavior), then independently clear-or-materialize `metricId` per D3/D4. */
  private def resolveOne(
      panel: Panel,
      ownedTypes: Map[DataTypeId, DataType],
      ownedMetrics: Map[MetricId, MetricDefinition]
  ): Panel = {
    val dtResolved = panel.dataTypeId match {
      case Some(typeId) if !ownedTypes.contains(typeId) => panel.withBindingCleared
      case _                                            => panel
    }
    metricIdOf(dtResolved) match {
      case None            => dtResolved
      case Some(metricId)  =>
        ownedMetrics.get(metricId) match {
          case None         => withMetricCleared(dtResolved)
          case Some(metric) => withMaterializedMetric(dtResolved, metric)
        }
    }
  }

  /** Public method used by routes that already have a Panel + a user. */
  def resolveBinding(panel: Panel, user: AuthenticatedUser): Future[Panel] =
    resolveSingleBinding(panel, user)

  /** Single-panel counterpart of `resolveOne`/`resolveBindingsForRead` — same
   *  clear-whole-binding-on-unresolved-dataTypeId + independent metricId
   *  clear-or-materialize (D3/D4), for the single-panel read paths (`update`'s
   *  post-patch resolve, the `/query` route's `findById`-then-`buildQuery`
   *  flow via `resolveBinding`). */
  private def resolveSingleBinding(panel: Panel, user: AuthenticatedUser): Future[Panel] = {
    val dataTypeIdOpt = panel.dataTypeId
    val metricIdOpt   = metricIdOf(panel)
    for {
      dtOwned <- dataTypeIdOpt match {
        case None     => Future.successful(true)
        case Some(id) => dataTypeRepo.findByIdOwned(id, user).map(_.isDefined)
      }
      metricOwned <- metricIdOpt match {
        case None     => Future.successful(Option.empty[MetricDefinition])
        case Some(id) => metricRepo.findByIdOwned(id, user)
      }
    } yield {
      val dtResolved = dataTypeIdOpt match {
        case Some(_) if !dtOwned => panel.withBindingCleared
        case _                   => panel
      }
      metricIdOf(dtResolved) match {
        case None => dtResolved
        case Some(_) =>
          metricOwned match {
            case None         => withMetricCleared(dtResolved)
            case Some(metric) => withMaterializedMetric(dtResolved, metric)
          }
      }
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
              case Right(panel) => panelRepo.insert(panel).map { inserted =>
                audit("panel.create", Some(inserted.id.value), user)
                Right(inserted)
              }
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
        rejectCompanionBinding(dataTypeIdFromCreateConfig(createConfig), user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            rejectUnresolvableMetric(metricIdFromCreateConfig(createConfig), user).map {
              case Left(err) => Left(err)
              case Right(_) =>
                val now = Instant.now()
                val panel = buildNewPanel(
                  id           = PanelId(UUID.randomUUID().toString),
                  dashboardId  = dashboardId,
                  title        = RequestValidation.normalizePanelTitle(request.title),
                  meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
                  appearance   = appearance,
                  ownerId      = user.id,
                  createConfig = createConfig
                )
                panel.validateConfig match {
                  case Left(msg) => Left(ServiceError.BadRequest(msg))
                  case Right(_)  => Right(panel)
                }
            }
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
              case true  =>
                audit("panel.delete", Some(panelId.value), user)
                Right(())
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
              case Some(p) =>
                // HEL-477 design.md Decision 7: one panel.duplicate row.
                audit("panel.duplicate", Some(p.id.value), user, JsObject("sourcePanelId" -> JsString(panelId.value)))
                Right(p)
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
                    _ <- validateBatchAggregationConflict(items.zip(panels))
                  } yield ()
                  batchValidation match {
                    case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
                    case Right(_) =>
                      val now = Instant.now()
                      panelRepo.batchUpdate(items, now)
                        .map { updated =>
                          // HEL-477 design.md Decision 9: one panel.batch_update
                          // row per call, not one per panel.
                          audit(
                            "panel.batch_update",
                            Some(dashboardId.value),
                            user,
                            JsObject("count" -> JsNumber(updated.size), "panelIds" -> JsArray(updated.map(p => JsString(p.id.value))))
                          )
                          Right(updated)
                        }
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
                case Right(built)  => panelRepo.insertBatch(built).map { inserted =>
                  // HEL-477 design.md Decision 9: one panel.batch_create row
                  // per call, not one per panel.
                  audit(
                    "panel.batch_create",
                    Some(dashboardId.value),
                    user,
                    JsObject("count" -> JsNumber(inserted.size), "panelIds" -> JsArray(inserted.map(p => JsString(p.id.value))))
                  )
                  Right(inserted)
                }
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
                validateScatterAggregationConflict(existing, spec) match {
                  case Left(err) =>
                    Future.successful(Left(ServiceError.BadRequest(err)))
                  case Right(_) =>
                    val incomingDataTypeId = spec.configPatch.flatMap(dataTypeIdFromConfigPatch)
                    val incomingMetricId   = spec.configPatch.flatMap(metricIdFromConfigPatch)
                    rejectCompanionBinding(incomingDataTypeId, user).flatMap {
                      case Left(err) => Future.successful(Left(err))
                      case Right(_) =>
                        rejectUnresolvableMetric(incomingMetricId, user).flatMap {
                          case Left(err) => Future.successful(Left(err))
                          case Right(_) =>
                            patchApplier.apply(panelId, spec, p => resolveSingleBinding(p, user))
                              .map {
                                case Some(panel) =>
                                  audit("panel.update", Some(panel.id.value), user)
                                  Right(panel)
                                case None        => Left(ServiceError.NotFound("Panel not found"))
                              }
                              .recover { case ex: IllegalArgumentException => Left(ServiceError.BadRequest(ex.getMessage)) }
                        }
                    }
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

  // ── Internal: reject an unresolvable/foreign/non-pipeline-output metricId (HEL-500) ──

  /** 400 when `metricIdOpt` doesn't resolve to a caller-owned metric, or
   *  resolves to one whose bound `DataType` no longer satisfies the V41
   *  pipeline-output rule — mirroring `rejectCompanionBinding`'s error style
   *  (400 `BadRequest`) but NOT its pass-through-on-unresolved behavior:
   *  AC3 requires an actively rejected foreign/nonexistent `metricId`, not a
   *  deferred-to-read-time clear (design.md D5). A `None` input (no
   *  `metricId` in this request) passes through unchanged. The `DataType`
   *  re-check is defensive — `MetricService.create` already enforces V41 at
   *  metric-creation time — guarding only against future drift. */
  private def rejectUnresolvableMetric(
      metricIdOpt: Option[MetricId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    metricIdOpt match {
      case None => Future.successful(Right(()))
      case Some(metricId) =>
        metricRepo.findByIdOwned(metricId, user).flatMap {
          case None =>
            Future.successful(Left(ServiceError.BadRequest("metricId does not resolve to a metric you own")))
          case Some(metric) =>
            dataTypeRepo.findByIdOwned(metric.dataTypeId, user).map {
              case Some(dt) if dt.sourceId.isEmpty => Right(())
              case _ => Left(ServiceError.BadRequest("metricId's bound data type is not a valid pipeline-output binding"))
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
