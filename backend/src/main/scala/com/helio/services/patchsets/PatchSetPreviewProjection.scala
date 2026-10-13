package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.panels.PlacementSizes
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.patchsets.EditPreview
import com.helio.domain.model._
import com.helio.domain.panels.OutputPanel
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** Pure(-ish) after-state projection for one resolved edit (design.md D2/D3/
 *  D1a, tasks.md 2.2) -- the read-only diff half of HEL-408's preview.
 *  `before` is `ResolvedEdit.priorStateJson` reused verbatim (design.md D2,
 *  HEL-406's own D4a field). `after` composes each kind's own PURE
 *  sub-computations (`PanelServiceHelpers.resolvePatch`, `PanelConfigCodec.
 *  applyConfigPatch`, `PanelAppearance.applyPatchJson`,
 *  `DashboardServiceValidation.validateDashboardUpdateRequest`,
 *  `PipelineStepConfigCodec.decode`) wherever one already exists -- never
 *  re-deriving logic those functions already own (design.md Context/Risks).
 *
 *  A handful of genuinely-extra content checks (design.md D1/D1a) run here
 *  too -- panel-update's blank-title/cross-type-PATCH (free, via
 *  `PanelServiceHelpers.resolvePatch` above) and pipeline-rename's
 *  blank-name check. HEL-904 task 3.3 removed the dataType-update/-delete
 *  content checks that used to live here outright -- dataType is no longer a
 *  valid target.kind. The panel-update scatter+aggregation conflict check
 *  (`PanelService.validateScatterAggregationConflict`) is ALSO gone, not just
 *  no-longer-mirrored: that validator, `ChartPanel`, and panel-side
 *  `aggregation` were all deleted by this same ticket (see the `panelUpdateAfter`
 *  comment below) -- there is nothing left for preview to mirror there. A
 *  `Left` from either remaining check fails the WHOLE `preview` call
 *  (design.md D1a), never silently dropped or per-edit-only.
 *
 *  This object is the dispatcher; each resource kind's after-state builders live in
 *  `PatchSetPreview{Panel,Dashboard,Source,Pipeline,Step}Projection.scala` (HEL-1498 split,
 *  behaviour-preserving), and the pipelineStep-specific 22-arm `.copy` dispatch lives in
 *  `PatchSetPreviewProjectionSteps.scala`. */
private[services] object PatchSetPreviewProjection {

  private[patchsets] val PendingId = "(pending)"

  /** Projection against the resolve-time state only (no earlier edits): the overlay-free entry point. */
  def project(
      edit: ResolvedEdit,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, EditPreview]] =
    project(edit, user, ctx, PatchSetPreviewOverlay.empty).map(_.map(_._1))

  /** Projects `edit` against the state the earlier edits of the set left in `overlay` (HEL-1498) and returns the
   *  preview plus the overlay extended with this edit's own effect. `before` and the fingerprint stay the
   *  resolve-time (pre-apply) state, exactly as apply's `priorState` and stale check. */
  private[services] def project(
      edit: ResolvedEdit,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext,
      overlay: PatchSetPreviewOverlay
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, (EditPreview, PatchSetPreviewOverlay)]] =
    computeAfter(edit, user, ctx, overlay).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right((afterOpt, afterEdit)) =>
        for {
          impact      <- PatchSetPreviewImpact.compute(edit, user, ctx, overlay)
          fingerprint <- PatchSetTargetFingerprint.forEdit(edit, user, ctx)
          extended    <- PatchSetPreviewRemovals.record(edit, ctx, afterEdit)
        } yield Right((EditPreview(edit.index, edit.kind, edit.op, edit.priorStateJson, afterOpt, impact, fingerprint), extended))
    }

  private type Projected = Either[ServiceError, (Option[JsValue], PatchSetPreviewOverlay)]

  private def gone(what: String): ServiceError = ServiceError.NotFound(s"$what not found (deleted by an earlier edit in this patch set)")

  /** A read of something an earlier edit removed fails the whole call, like apply's mid-set failure. */
  private def unlessRemoved(overlay: PatchSetPreviewOverlay, kind: String, id: String, what: String)(
      f: => Projected
  ): Future[Projected] =
    Future.successful(if (overlay.isRemoved(kind, id)) Left(gone(what)) else f)

  private def computeAfter(
      edit: ResolvedEdit,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext,
      overlay: PatchSetPreviewOverlay
  )(implicit ec: ExecutionContext): Future[Projected] =
    edit.action match {
      case ResolvedAction.PanelUpdate(id, request, prior) =>
        unlessRemoved(overlay, "panel", id.value, "Panel") {
          PatchSetPreviewPanelProjection.panelUpdateAfter(request, overlay.panel(prior)).map {
            case (json, panel) => (Some(json), overlay.withPanel(panel))
          }
        }
      case ResolvedAction.PanelDelete(id, _) =>
        unlessRemoved(overlay, "panel", id.value, "Panel")(Right((None, overlay)))
      case ResolvedAction.PanelCreate(request) =>
        panelCreate(edit, request, user, ctx, overlay)

      case ResolvedAction.DashboardUpdate(id, request, prior) =>
        if (overlay.isRemoved("dashboard", id.value)) Future.successful(Left(gone("Dashboard")))
        else
          ctx.dashboardRepo.panelIdsInternal(prior.id).map { stored =>
            PatchSetPreviewDashboardProjection.dashboardUpdateAfter(request, overlay.dashboard(prior), stored, overlay).map {
              case (json, dashboard) => (Some(json), overlay.withDashboard(dashboard))
            }
          }
      case ResolvedAction.DashboardDelete(id, _) =>
        unlessRemoved(overlay, "dashboard", id.value, "Dashboard")(Right((None, overlay)))
      case ResolvedAction.DashboardCreate(request) =>
        Future.successful(Right((Some(PatchSetPreviewDashboardProjection.dashboardCreateAfter(request, user)), overlay)))

      case ResolvedAction.DataSourceUpdate(id, request, prior) =>
        unlessRemoved(overlay, "dataSource", id.value, "Data source") {
          val (json, updated) = PatchSetPreviewSourceProjection.dataSourceUpdateAfter(request, overlay.dataSource(prior))
          Right((Some(json), overlay.withDataSource(updated)))
        }
      case ResolvedAction.DataSourceDelete(id, _) =>
        unlessRemoved(overlay, "dataSource", id.value, "Data source")(Right((None, overlay)))
      case ResolvedAction.DataSourceCreate(request) =>
        Future.successful(Right((Some(PatchSetPreviewSourceProjection.dataSourceCreateAfter(request, user)), overlay)))

      // HEL-904 task 3.3: the `dataType` update/delete content checks are
      // REMOVED outright -- `dataType` is no longer a valid target.kind.

      case ResolvedAction.PipelineUpdate(id, request, prior) =>
        unlessRemoved(overlay, "pipeline", id.value, "Pipeline") {
          PatchSetPreviewPipelineProjection.pipelineRenameAfter(request, overlay.pipeline(prior)).map {
            case (json, updated) => (Some(json), overlay.withPipeline(updated))
          }
        }
      case ResolvedAction.PipelineDelete(id, _) =>
        unlessRemoved(overlay, "pipeline", id.value, "Pipeline")(Right((None, overlay)))
      case ResolvedAction.PipelineCreate(request) =>
        PatchSetPreviewPipelineProjection.pipelineCreateAfter(request, user, ctx, overlay).map(_.map(json => (json, overlay)))

      // ── pipelineStep (HEL-914 task 5.2: create added) ──────────────────
      case ResolvedAction.PipelineStepUpdate(id, request, prior) =>
        unlessRemoved(overlay, "pipelineStep", id.value, "Pipeline step") {
          PatchSetPreviewStepProjection.pipelineStepUpdateAfter(request, overlay.step(prior)).map {
            case (json, updated) => (Some(json), overlay.withStep(updated))
          }
        }
      case ResolvedAction.PipelineStepDelete(id, _) =>
        unlessRemoved(overlay, "pipelineStep", id.value, "Pipeline step")(Right((None, overlay)))
      case ResolvedAction.PipelineStepCreate(pipelineId, request) =>
        // A create's `after` has no prior `PipelineStep` domain object to `.copy` onto (unlike
        // update's `pipelineStepUpdateAfter`) and no persisted position/root yet -- a lightweight,
        // honest "what you asked for" echo (pending id, type, config, and the tree-shape fields
        // that decide which lane this becomes) rather than a fabricated full typed response.
        // A parent (or pipeline) an earlier edit deleted is rejected as `StepPlacement` rejects an unknown parent.
        val parentGone = request.parentStepId.exists(overlay.isRemoved("pipelineStep", _)) || overlay.isRemoved("pipeline", pipelineId.value)
        Future.successful(
          if (parentGone) Left(ServiceError.UnprocessableEntity("parentStepId is not a step of this pipeline (deleted by an earlier edit in this patch set)"))
          else Right((Some(PatchSetPreviewStepProjection.pipelineStepCreateAfter(request)), overlay))
        )

      // ── output (HEL-1239) ────────────────────────────────────────────────
      case ResolvedAction.OutputUpdate(id, request, prior, priorConfig) =>
        unlessRemoved(overlay, "output", id.value, "Output") {
          val (basis, basisConfig) = overlay.output(prior, priorConfig)
          PatchSetPreviewPipelineProjection.outputUpdateAfter(request, basis, basisConfig).map {
            case (json, updated, config) => (Some(json), overlay.withOutput(updated, config))
          }
        }
      case ResolvedAction.OutputDelete(id, _) =>
        unlessRemoved(overlay, "output", id.value, "Output")(Right((None, overlay)))
    }

  /** A panel create: rejected when the dashboard or Output it names was deleted by an earlier edit; otherwise its
   *  placement (sized exactly as `PanelService.create` sizes it) joins the dashboard's layout ops under the
   *  placeholder id `(pending:<editIndex>)`. */
  private def panelCreate(
      edit: ResolvedEdit,
      request: CreatePanelRequest,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext,
      overlay: PatchSetPreviewOverlay
  )(implicit ec: ExecutionContext): Future[Projected] = {
    val panel       = PatchSetPreviewPanelProjection.panelCreateBuild(request, user)
    val dashboardId = panel.dashboardId.value
    val outputId    = Option(panel).collect { case o: OutputPanel => o.outputId }.flatten
    if (overlay.isRemoved("dashboard", dashboardId)) Future.successful(Left(gone("Dashboard")))
    else if (outputId.exists(o => overlay.isRemoved("output", o.value))) Future.successful(Left(gone("Output")))
    else {
      val kindF = outputId match {
        case None    => Future.successful(None)
        case Some(o) => overlay.outputs.get(o.value).map(x => Future.successful(Option(x._1))).getOrElse(ctx.outputRepo.findByIdInternal(o)).map(_.map(_.kind))
      }
      kindF.map { kind =>
        val extended =
          if (dashboardId.isEmpty) overlay
          else overlay.withPanelCreated(dashboardId, s"(pending:${edit.index})", PlacementSizes.forNewPanel(panel, kind))
        Right((Some(PatchSetPreviewPanelProjection.panelCreateAfter(panel)), extended))
      }
    }
  }
}
