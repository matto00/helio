package com.helio.services.panels

import com.helio.services.{FormSubmitError, ServiceError}
import com.helio.services.auth.AccessChecker
import com.helio.services.audit.AuditService
import com.helio.services.sources.{DataSourceService, RowWriteResult}
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.panels.{CreatePanelRequest, CreatePanelsBatchRequest, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.domain.panels.OutputPanel
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
    accessChecker: AccessChecker,
    dashboardRepo: DashboardRepository,
    // HEL-477: nullable-optional wiring — a fixture that doesn't pass one
    // simply never audits (see `audit` below).
    auditService: AuditService = null,
    // HEL-904 follow-up (flagged cycle 17): appended last, nullable-optional
    // (default `null`) so every existing positional caller stays unmodified.
    // A `null` outputRepo skips the outputId-existence check entirely (same
    // convention as a fixture that never wires `auditService`) — only
    // exercised once a caller actually creates/patches an `"output"`-kind
    // panel with a non-empty `outputId`.
    outputRepo: OutputRepository = null,
    // HEL-1083: nullable-optional wiring, same convention as `outputRepo` —
    // a `null` dataSourceRepo skips the dataSourceId-existence/ownership
    // check entirely, only exercised once a caller actually creates/patches
    // a `"form"`-kind panel with a non-empty `dataSourceId` (design.md D6).
    dataSourceRepo: DataSourceRepository = null,
    // HEL-1087: nullable-optional wiring, same convention as `dataSourceRepo` — a `null`
    // dataSourceService means `submitForm` is the only method that can't be called (every other
    // existing caller/fixture is unaffected, appended last).
    dataSourceService: DataSourceService = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val patchApplier = new PanelPatchApplier(panelRepo)

  /** Fire-and-forget audit call, a no-op when `auditService` is `null`.
   *  HEL-483: `source`/`actor_token_id` come from the caller's resolved
   *  credential via `AuthenticatedUser`. */
  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser, metadata: JsValue = JsObject.empty): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, "panel", resourceId, metadata)


  /** Sharing-aware read. Returns the panel only when the caller has access
   *  to the parent dashboard (owner, grantee, or public viewer when
   *  `callerOpt = None`). Closes the `/api/panels/:id/query` ACL hole. */
  def findById(panelId: PanelId, callerOpt: Option[AuthenticatedUser]): Future[Option[Panel]] =
    panelRepo.findById(panelId, callerOpt)

  /** `POST /api/panels/:id/submit` (HEL-1087 design.md D1/D4). Sharing-aware visibility
   *  (`findById`) → `404`; non-`form` panel → `400`; a visible panel the caller doesn't OWN →
   *  `403` (D4's message — decidable from the panel alone: a grantee's insert could not succeed
   *  under their own RLS context anyway, and the panel owner is the source owner by HEL-1084's
   *  config-time ownership check). Delegates the actual build+write to
   *  `DataSourceService.appendFormRow`, partially applying `FormSubmission.buildRow` over the
   *  panel's config and the submitted `values` — the declaration itself is resolved fresh, under
   *  the source's own lock, INSIDE that call, never here (D3's "no pre-lock mapping" rule). */
  def submitForm(panelId: PanelId, values: Map[String, JsValue], user: AuthenticatedUser): Future[Either[FormSubmitError, RowWriteResult]] =
    panelRepo.findById(panelId, Some(user)).flatMap {
      case None => Future.successful(Left(FormSubmitError(ServiceError.NotFound("Panel not found"))))
      case Some(panel: FormPanel) =>
        if (panel.ownerId != user.id)
          Future.successful(Left(FormSubmitError(ServiceError.Forbidden("Only this form's owner can submit to its data source"))))
        else {
          val build: Vector[DatasetFieldDeclaration] => Either[Vector[DatasetRowValidator.FieldError], Vector[JsValue]] =
            declaration => FormSubmission.buildRow(panel.config, declaration, values)
          dataSourceService.appendFormRow(panel.config.dataSourceId, build, panelId, user)
        }
      case Some(_) => Future.successful(Left(FormSubmitError(ServiceError.BadRequest("panel is not a form panel"))))
    }

  /** `POST /api/panels`. Returns the inserted panel plus, for an Output
   *  panel only, the decision-15 default-size [[DashboardLayoutItem]] it was
   *  placed at on `dashboardId`'s grid (epic spec
   *  `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`
   *  lines 44/140/224 — HEL-909 CR1). A non-Output panel (text/markdown/
   *  image/divider) gets no server-owned placement — `None`, unchanged
   *  behavior. */
  def create(
      request: CreatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Panel, Option[DashboardLayoutItem])]] =
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
              case Right(panel) => panelRepo.insert(panel).flatMap { inserted =>
                audit("panel.create", Some(inserted.id.value), user)
                placeDefaultLayout(dashboardId, inserted).map(layout => Right((inserted, layout)))
              }
            }
        }
    }

  /** Decision-15: compute the placed Output's kind-driven default size
   *  (`OutputPanelDefaultSize`), append it below the dashboard's current
   *  lowest occupied `lg` row (no collision-avoidance against kept items —
   *  a single-item append onto an existing layout has nothing in common
   *  with `AutoLayoutService`'s D6 whole-board re-pack, which is a distinct,
   *  explicit, user-invoked operation over every panel on the board; this
   *  method does not lean on that as precedent), and persist it on
   *  `dashboards.layout`. HEL-909 CR1 cycle-2 fix: each breakpoint's
   *  EXISTING array is preserved and appended to independently — never
   *  replaced with `lg`'s array — and the appended item is scaled to that
   *  breakpoint's column count via `LayoutBreakpointScaling.scaleItemToBreakpoint`
   *  (mirroring the frontend's `projectLayout`), not the raw `lg`
   *  dimensions. A `null` `outputRepo` (unwired fixture, mirrors this
   *  file's other nullable-optional DI) or a non-Output panel both no-op to
   *  `None` without touching the dashboard. */
  private def placeDefaultLayout(dashboardId: DashboardId, panel: Panel): Future[Option[DashboardLayoutItem]] =
    panel match {
      case outputPanel: OutputPanel if outputRepo != null =>
        outputPanel.outputId match {
          case None => Future.successful(None)
          case Some(outputId) =>
            outputRepo.findByIdInternal(outputId).flatMap {
              case None => Future.successful(None)
              case Some(output) =>
                val size = OutputPanelDefaultSize.forKind(output.kind)
                dashboardRepo.findByIdInternal(dashboardId).flatMap {
                  case None => Future.successful(None)
                  case Some(dashboard) =>
                    val y       = (dashboard.layout.lg.map(i => i.y + i.h) :+ 0).max
                    val lgItem  = DashboardLayoutItem(panel.id, x = 0, y = y, w = size.w, h = size.h)
                    val lgCols  = LayoutBreakpointScaling.breakpointCols("lg")
                    val nextLg  = dashboard.layout.lg :+ lgItem
                    val nextMd  = dashboard.layout.md :+ LayoutBreakpointScaling.scaleItemToBreakpoint(lgItem, lgCols, LayoutBreakpointScaling.breakpointCols("md"))
                    val nextSm  = dashboard.layout.sm :+ LayoutBreakpointScaling.scaleItemToBreakpoint(lgItem, lgCols, LayoutBreakpointScaling.breakpointCols("sm"))
                    val nextXs  = dashboard.layout.xs :+ LayoutBreakpointScaling.scaleItemToBreakpoint(lgItem, lgCols, LayoutBreakpointScaling.breakpointCols("xs"))
                    val updatedDashboard = dashboard.copy(
                      layout = DashboardLayout(lg = nextLg, md = nextMd, sm = nextSm, xs = nextXs),
                      meta   = dashboard.meta.copy(lastUpdated = Instant.now())
                    )
                    dashboardRepo.update(updatedDashboard).map(_ => Some(lgItem))
                }
            }
        }
      case _ => Future.successful(None)
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
        rejectMissingOutput(outputIdFromCreateConfig(createConfig), user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => rejectMissingDataSource(dataSourceIdFromCreateConfig(createConfig), user)
        }.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  =>
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
              case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
              case Right(_)  =>
                rejectInconsistentForm(formConfigOf(panel), user).map {
                  case Left(err) => Left(err)
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
                val incomingOutputId     = spec.configPatch.flatMap(outputIdFromConfigPatch)
                val incomingDataSourceId = spec.configPatch.flatMap(dataSourceIdFromConfigPatch)
                rejectMissingOutput(incomingOutputId, user).flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_)  => rejectMissingDataSource(incomingDataSourceId, user)
                }.flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_)  => rejectInconsistentForm(effectiveFormConfig(existing, spec), user)
                }.flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_) =>
                    patchApplier.apply(panelId, spec)
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

  // HEL-904 task 4.1: `rejectCompanionBinding` (enforce-pipeline-only-bindings,
  // V41) removed outright — Text/Markdown's data-bound "Source mode" no
  // longer exists, so no panel-create/patch path can carry a `dataTypeId`
  // binding to reject in the first place.

  /** 404 when `outputIdOpt` is provided but does not resolve to a real,
   *  owned Output. HEL-904 follow-up (flagged cycle 17): closes the gap where
   *  an `"output"`-kind panel's `outputId` reached `panelRepo.insert`/
   *  `patchApplier.apply` unchecked and hit the raw `panels.output_id` FK
   *  violation as a 500 instead of a clean, explicit rejection. A `None`
   *  input (no outputId in this create/patch) or a `null` `outputRepo`
   *  (unwired caller — mirrors this file's other nullable-optional
   *  dependencies) both pass through unchanged. */
  private def rejectMissingOutput(
      outputIdOpt: Option[OutputId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    outputIdOpt match {
      case None => Future.successful(Right(()))
      case Some(_) if outputRepo == null => Future.successful(Right(()))
      case Some(outputId) =>
        outputRepo.findByIdOwned(outputId, user).map {
          case Some(_) => Right(())
          case None    => Left(ServiceError.NotFound("Output not found"))
        }
    }

  /** 404 when `dataSourceIdOpt` is provided but does not resolve to a real,
   *  owned data source (design.md D6). Mirrors `rejectMissingOutput`
   *  verbatim, including its nullable-optional repository wiring so no
   *  existing fixture changes behaviour, and its `findByIdOwned` →
   *  not-found mapping so existence is never leaked (never 403, never 500). */
  private def rejectMissingDataSource(
      dataSourceIdOpt: Option[DataSourceId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    dataSourceIdOpt match {
      case None => Future.successful(Right(()))
      case Some(_) if dataSourceRepo == null => Future.successful(Right(()))
      case Some(dataSourceId) =>
        dataSourceRepo.findByIdOwned(dataSourceId, user).map {
          case Some(_) => Right(())
          case None    => Left(ServiceError.NotFound("Data source not found"))
        }
    }

  /** Extracts a `form` panel's config from a domain `Panel`, `None` for every other kind. Feeds
   *  `rejectInconsistentForm` with the effective (post-patch, on `update`) config. */
  private def formConfigOf(panel: Panel): Option[FormPanelConfig] = panel match {
    case p: FormPanel => Some(p.config)
    case _            => None
  }

  /** The EFFECTIVE post-patch form config for `update` (C2): `existing` as a `FormPanel`,
   *  `applyPatch`ed with the decoded form patch — never the incoming patch alone, so a
   *  `dataSourceId`-only PATCH re-validates the existing fields against the new dataset. `None`
   *  when `existing` is not a `form` panel, or the patch carries no `configPatch` at all (nothing
   *  form-related changed, nothing to re-check). */
  private def effectiveFormConfig(existing: Panel, spec: ResolvedPanelPatch): Option[FormPanelConfig] =
    (existing, spec.configPatch) match {
      case (form: FormPanel, Some(patchJson)) =>
        Some(form.applyPatch(FormPanelConfig.Patch.decode(patchJson)).config)
      case _ => None
    }

  /** HEL-1084 design.md D1: schema-consistency check for a `form` panel's config, evaluated on
   *  the EFFECTIVE config (C2) — the caller passes the post-patch config on update, never the
   *  incoming patch alone, so a `dataSourceId`-only PATCH still re-validates the existing fields
   *  against the new dataset. `None` (not a form panel, or a form config with an empty
   *  `dataSourceId` — `rejectMissingDataSource` already 400s/404s that case) and a `null`
   *  `dataSourceRepo` (unwired fixture, mirrors this file's other nullable-optional dependencies)
   *  both skip the check. Rule (a) — bound source must be `dataset`-kind — is checked here since
   *  it needs the resolved `DataSource`, not just its declaration; (b)-(e) delegate to
   *  `FormSchemaConsistency.check`. */
  private def rejectInconsistentForm(
      configOpt: Option[FormPanelConfig],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    configOpt.filter(_.dataSourceId.value.nonEmpty) match {
      case None => Future.successful(Right(()))
      case Some(_) if dataSourceRepo == null => Future.successful(Right(()))
      case Some(config) =>
        dataSourceRepo.findByIdOwned(config.dataSourceId, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("Data source not found")))
          case Some(_: DatasetSource) =>
            dataSourceRepo.getDeclaredSchema(config.dataSourceId, user).map {
              case None => Left(ServiceError.NotFound("Data source not found"))
              case Some(declaration) =>
                FormSchemaConsistency.check(config, declaration) match {
                  case Left(msg) => Left(ServiceError.BadRequest(msg))
                  case Right(()) => Right(())
                }
            }
          case Some(ds) =>
            Future.successful(Left(ServiceError.BadRequest(s"form panels must be bound to a dataset source (this source is '${ds.kind}')")))
        }
    }

  // HEL-904 task 3.9/4.1: `rejectUnresolvableMetric` (HEL-500) and
  // `metricRepo` (the constructor's legacy unused parameter) both removed —
  // metrics no longer exist.

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
