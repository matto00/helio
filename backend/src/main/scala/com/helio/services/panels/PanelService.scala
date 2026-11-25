package com.helio.services.panels

import com.helio.services.{FormSubmitError, ServiceError}
import com.helio.services.dashboards.DashboardAccessMessages
import com.helio.services.auth.AccessChecker
import com.helio.services.audit.AuditService
import com.helio.services.sources.{DataSourceService, RowWriteResult}
import com.helio.api.protocols.panels.{CreatePanelRequest, CreatePanelsBatchRequest, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}
import com.helio.infrastructure.persistence.sources.{DataSourceRepository, StoredObjectDeletionRepository}
import com.helio.infrastructure.storage.FileSystem
import com.helio.services.panels.PanelServiceHelpers._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/panels`. Absorbs the prior `PanelPatchService` so
 *  the patch resolver + step-by-step applier live with the rest of panel CRUD.
 *
 *  ACL strategy (CS4):
 *  - `findById` uses `panelRepo.findById(id, Some(user))` — sharing-aware via
 *    the parent dashboard. This closes the `/api/panels/:id/query` hole where
 *    any authenticated user could query any panel regardless of dashboard ACL.
 *  - `batchUpdate`, `delete`, `duplicate` and `update` resolve panels with the
 *    sharing-aware `panelRepo.findById(id, Some(user))` (HEL-1002): a panel the
 *    caller cannot see is `NotFound("Panel not found")`, indistinguishable from
 *    an absent one. Only for a visible panel does the dashboard-level role check
 *    (`authorizeEditorOnDashboard` / `requireAccess`: Viewer -> 403) run.
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
    // HEL-1295: required (no default, never null — enforced by the `require` below). Backs the
    // outputId-existence/ownership check on `"output"`-kind panels and default sizing.
    outputRepo: OutputRepository,
    // HEL-1083: nullable-optional wiring, same convention as `auditService` —
    // a `null` dataSourceRepo skips the dataSourceId-existence/ownership
    // check entirely, only exercised once a caller actually creates/patches
    // a `"form"`-kind panel with a non-empty `dataSourceId` (design.md D6).
    dataSourceRepo: DataSourceRepository = null,
    // HEL-1087: nullable-optional wiring, same convention as `dataSourceRepo` — a `null`
    // dataSourceService means `submitForm` is the only method that can't be called (every other
    // existing caller/fixture is unaffected, appended last).
    dataSourceService: DataSourceService = null,
    // HEL-1086: nullable-optional wiring, same convention as `dataSourceService` — a `null`
    // fileSystem only breaks `submitForm` when the caller actually attaches a file (the
    // no-file submit path never touches it, matching every other existing fixture/caller).
    fileSystem: FileSystem = null,
    // HEL-1189: nullable-optional wiring, same convention as `dataSourceRepo` — a `null`
    // nodeSnapshotRepo skips `rejectInvalidControls`'s `dropdown`-kind eq/in cardinality check
    // entirely (only that one kind needs it; text/numeric-range/date-range eligibility is derived
    // purely from the Output's declared schema, zero DB cost — design.md D3), only exercised once a
    // caller actually adds/rebinds a `dropdown` control on an "output"-kind panel.
    nodeSnapshotRepo: NodeSnapshotRepository = null,
    // HEL-1530: nullable-optional wiring, same convention as `fileSystem` -- a `null` repo only disables the
    // failed-append compensation of a file-attached form submit (the stored objects are then left, never deleted).
    storedObjectDeletionRepo: StoredObjectDeletionRepository = null
)(implicit ec: ExecutionContext) {

  require(outputRepo != null, "PanelService requires an OutputRepository")

  private val patchApplier = new PanelPatchApplier(panelRepo)
  private val outputControlsValidator = new OutputControlsValidator(outputRepo, nodeSnapshotRepo)
  private val batchControlsCheck      = new BatchControlsCheck(outputControlsValidator)
  // The concerns split out of this file (HEL-1253); each is built once from this class's own
  // constructor params, so the nullable-optional dependencies keep their exact semantics. Every ACL
  // / `Forbidden` / 404 preamble stays below in this file.
  private val bindingChecks    = new PanelBindingChecks(outputRepo, dataSourceRepo)
  private val createBuilder    = new PanelCreateBuilder(bindingChecks, outputControlsValidator)
  private val formFiles        = new PanelFormFileSubmission(dataSourceRepo, dataSourceService, fileSystem, storedObjectDeletionRepo)
  private val updateValidation = new PanelUpdateValidation(bindingChecks, outputControlsValidator)
  private val batchWrites      = new PanelBatchWrites(panelRepo, bindingChecks, createBuilder, batchControlsCheck, audit)
  private val lifecycleWrites  = new PanelLifecycleWrites(panelRepo, bindingChecks, createBuilder, audit)

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

  /** `POST /api/panels/:id/submit` (HEL-1087 design.md D1/D4, HEL-1086 design.md D2). Sharing-aware
   *  visibility (`findById`) -> `404`; non-`form` panel -> `400`; then (HEL-1784 D1) the caller must be the
   *  dashboard's owner or an editor: a named viewer is `403` (view-only message), a caller with no named grant
   *  (a public dashboard included) is `404`. The write then runs in the FORM OWNER's database context
   *  (`DataSourceService.appendFormRow`, design.md D2), so a binding to a source the form owner does not own writes
   *  nothing. `files` is empty for the plain-JSON submit path -- delegates straight to `appendFormRow`, partially
   *  applying `FormSubmission.buildRow` over the panel's config and the submitted `values`, the declaration resolved
   *  fresh, under the source's own lock, INSIDE that call (D3's "no pre-lock mapping" rule). A non-empty `files`
   *  routes through `submitFormWithFiles` instead (HEL-1086 D2's two-phase validate-then-store). A submitter who is
   *  not the form's owner gets the masked errors of [[FormSubmitErrorMasking]] and a result without `seq`. */
  def submitForm(
      panelId: PanelId,
      values:  Map[String, JsValue],
      user:    AuthenticatedUser,
      files:   Map[String, (String, Array[Byte])] = Map.empty,
      submitKey: Option[UUID] = None
  ): Future[Either[FormSubmitError, FormSubmitResult]] =
    panelRepo.findById(panelId, Some(user)).flatMap {
      case None => Future.successful(Left(FormSubmitError(ServiceError.NotFound("Panel not found"))))
      case Some(panel: FormPanel) =>
        authorizeEditorOnDashboard(panel.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(FormSubmitError(err)))
          case Right(_) =>
            val isFormOwner = panel.ownerId == user.id
            val written: Future[Either[FormSubmitError, RowWriteResult]] =
              if (files.isEmpty) {
                val build: (Vector[DatasetFieldDeclaration], Instant) => Either[Vector[DatasetRowValidator.FieldError], Vector[JsValue]] =
                  (declaration, now) => FormSubmission.buildRow(panel.config, declaration, values, now)
                dataSourceService.appendFormRow(panel.config.dataSourceId, build, panelId, user, panel.ownerId, submitKey)
              } else formFiles.submitFormWithFiles(panelId, panel, values, files, user)
            written.map {
              case Right(result) => Right(FormSubmitResult(result, writerIsFormOwner = isFormOwner))
              case Left(error)   => Left(if (isFormOwner) error else FormSubmitErrorMasking.forNonOwner(panel.config, error))
            }
        }
      case Some(_) => Future.successful(Left(FormSubmitError(ServiceError.BadRequest("panel is not a form panel"))))
    }

  /** `GET /api/panels/:id/form-schema` (HEL-1784 design.md D3): the declarations of the fields the form binds, in the
   *  dataset's declared order, for a dashboard owner or editor (same admission as [[submitForm]], re-checked per
   *  request). Read in the form owner's database context; nothing else of the dataset's schema and no row. */
  def formSchema(panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[DatasetFieldDeclaration]]] =
    panelRepo.findById(panelId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(panel: FormPanel) =>
        authorizeEditorOnDashboard(panel.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            dataSourceRepo.getDeclaredSchema(panel.config.dataSourceId, DataSourceService.ownerContext(panel.ownerId, user)).map {
              case None => Left(ServiceError.NotFound("Data source not found"))
              case Some(declaration) =>
                val bound = panel.config.fields.map(_.sourceField).toSet
                Right(declaration.filter(f => bound.contains(f.name)))
            }
        }
      case Some(_) => Future.successful(Left(ServiceError.BadRequest("panel is not a form panel")))
    }

  /** `POST /api/panels`. Returns the inserted panel plus the [[DashboardLayoutItem]] it was placed at
   *  in EACH breakpoint of `dashboardId`'s grid, for every panel kind (HEL-1260). The panel insert and
   *  its layout append are one transaction ([[PanelRepository.insertPlaced]]), so a panel is never
   *  stored without its item, and concurrent creates never lose one. */
  def create(
      request: CreatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Panel, PlacedLayouts)]] =
    validateCreatePanelRequest(request) match {
      case Left(error) =>
        Future.successful(Left(ServiceError.BadRequest(error)))
      case Right(dashboardId) =>
        accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(ResourceAccess.Viewer) =>
            Future.successful(Left(ServiceError.Forbidden(DashboardAccessMessages.ViewOnly)))
          case Right(_) =>
            lifecycleWrites.createPlaced(dashboardId, request, user)
        }
    }

  /** Delegates to [[PanelCreateBuilder.buildForCreate]]. */
  private[services] def buildForCreate(
      dashboardId: DashboardId,
      request: CreatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Panel]] =
    createBuilder.buildForCreate(dashboardId, request, user)

  /** Delegates to [[PanelCreateBuilder.buildAllForCreate]]. */
  private[services] def buildAllForCreate(
      dashboardId: DashboardId,
      requests: Vector[CreatePanelRequest],
      user: AuthenticatedUser,
      itemLabel: Int => Option[String] = _ => None
  ): Future[Either[ServiceError, Vector[Panel]]] =
    createBuilder.buildAllForCreate(dashboardId, requests, user, itemLabel)

  def delete(panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    panelRepo.findById(panelId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(panel) =>
        authorizeEditorOnDashboard(panel.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            lifecycleWrites.deleteRow(panelId, user)
        }
    }

  /** `POST /api/panels/:id/duplicate`: the copy is stored with an item in every breakpoint, appended in the
   *  same transaction (HEL-1260); see [[CreatePlacement.duplicateSizes]] for its size. */
  def duplicate(panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, (Panel, PlacedLayouts)]] =
    panelRepo.findById(panelId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(panel) =>
        authorizeEditorOnDashboard(panel.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            lifecycleWrites.duplicatePlaced(panel, panelId, user)
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
      Future.traverse(items)(item => panelRepo.findById(PanelId(item.id), Some(user))).flatMap { panelOpts =>
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
                  Future.successful(Left(ServiceError.Forbidden(DashboardAccessMessages.ViewOnly)))
                case Right(_) =>
                  batchWrites.updateValidated(items, panels, dashboardId, user)
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
   *  does `panelRepo.insertBatchPlaced` run (panels AND their layout items in one transaction, HEL-1260) — zero DB writes on any invalid item. */
  def batchCreate(
      request: CreatePanelsBatchRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[(Panel, PlacedLayouts)]]] =
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
              batchWrites.createValidated(request, dashboardId, user)
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
          case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden(DashboardAccessMessages.ViewOnly))
          case Right(_)                     => Right(())
        }
    }

  def update(
      panelId: PanelId,
      request: UpdatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Panel]] =
    panelRepo.findById(panelId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Panel not found")))
      case Some(existing) =>
        authorizeEditorOnDashboard(existing.dashboardId, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            updateValidation.validate(existing, request, user).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(spec) =>
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

  private def authorizeEditorOnDashboard(
      dashboardId: DashboardId,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
      case Left(err)                                                       => Left(err)
      case Right(ResourceAccess.Viewer)                                    => Left(ServiceError.Forbidden(DashboardAccessMessages.ViewOnly))
      case Right(ResourceAccess.Owner) | Right(ResourceAccess.Editor)     => Right(())
    }
}
