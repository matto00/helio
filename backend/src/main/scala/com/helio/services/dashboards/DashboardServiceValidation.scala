package com.helio.services.dashboards

import com.helio.api.http.RequestValidation
import com.helio.api.protocols.dashboards.{DashboardAppearancePayload, DashboardLayoutItemPayload, DashboardLayoutPatchPayload, DashboardLayoutPayload, DashboardSnapshotPanelEntry, DashboardSnapshotPayload, UpdateDashboardRequest}
import com.helio.domain.model._
import com.helio.domain.panels.PanelConfigCodec
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutPolicy, LayoutReflow, LayoutValidator}

/** Static validators and normalizers extracted from [[DashboardService]]
 *  to keep that file within the 300-line budget. Methods retain their
 *  original visibility: `private[services]` where they were already so,
 *  and promoted to `private[services]` for the three that were formerly
 *  `private` inside the companion object. */
object DashboardServiceValidation {

  /** Validate a snapshot payload at import time. */
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
   *  before the importer reaches the repository). Also enforces the one
   *  cross-field rule this ticket (HEL-624) adds to import: a chart entry
   *  combining `chartType: "scatter"` with a present `aggregation` is
   *  rejected — the 5th of D2's five enforcement sites. No raw-JSON peeking
   *  is needed here (unlike the `PanelService`/`ProposalPanelSupport` sites):
   *  `entry.appearance.chart.chartType` and the decoded config's
   *  `aggregation` are already typed and are the exact values
   *  `DashboardSnapshotRepository.importSnapshot` will persist.
   *
   *  HEL-910 task 2.2 (design.md Decision 5, Gap B): general appearance/cross-field
   *  validation (the same `Panel.validateConfig` + appearance-payload validate path
   *  `PanelService.buildForCreate` runs) previously was skipped entirely on import — that gap
   *  is now closed in `DashboardService.importSnapshot` via `validateImportPanels`, which runs
   *  BEFORE `dashboardRepo.importSnapshot`'s write. This method here stays scoped to
   *  type/config-shape decode + the one HEL-624 cross-field rule; the fuller check lives next
   *  to the repo call it gates, not duplicated here. */
  private[services] def validatePanelEntries(panels: Vector[DashboardSnapshotPanelEntry]): Either[String, Unit] =
    panels.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), entry) =>
        PanelType.fromString(entry.`type`).flatMap { _ =>
          // HEL-904: the `ChartPanel`-scoped scatter/aggregation cross-field
          // check (D2's 5th enforcement site) was removed here along with
          // `ChartPanel` itself — Outputs carry no panel-side `aggregation`
          // field to conflict with a chart type.
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

  /** HEL-1233: an imported breakpoint that is out of bounds or overlapping is stored repaired
   *  rather than rejected (a dashboard exported while holding a grandfathered bad breakpoint must
   *  re-import). The repair is [[LayoutReflow]] over the breakpoint's own items at its own column
   *  count, so it is valid by construction and keeps exactly the same panels; valid breakpoints
   *  are returned untouched. Layout-to-panel references are checked earlier and still 400. */
  private[services] def repairImportedLayoutGeometry(payload: DashboardSnapshotPayload): DashboardSnapshotPayload = {
    val l = payload.dashboard.layout
    def repair(bp: String, ps: Vector[DashboardLayoutItemPayload]): Vector[DashboardLayoutItemPayload] = {
      val items = ps.map(DashboardLayoutItemPayload.toDomain)
      val cols  = LayoutBreakpointScaling.breakpointCols(bp)
      if (LayoutValidator.isValid(items.map(LayoutValidator.toRect), cols)) ps
      else
        LayoutReflow.reflow(LayoutReflow.fromItems(items), cols, cols)
          .map(i => DashboardLayoutItemPayload(i.panelId.value, i.x, i.y, i.w, i.h))
    }
    val repaired = DashboardLayoutPayload(repair("lg", l.lg), repair("md", l.md), repair("sm", l.sm), repair("xs", l.xs))
    payload.copy(dashboard = payload.dashboard.copy(layout = repaired))
  }

  /** Validate + normalize a dashboard PATCH payload. Returns the trimmed
   *  name (if any), normalized appearance (if any), and validated layout
   *  (if any). */
  private[services] def validateDashboardUpdateRequest(
      request: UpdateDashboardRequest
  ): Either[String, (Option[String], Option[DashboardAppearance], Option[LayoutPolicy.Patch])] = {
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

  private[services] def normalizeAppearance(p: DashboardAppearancePayload): DashboardAppearance =
    DashboardAppearance(
      background     = RequestValidation.normalizeDashboardBackground(p.background),
      gridBackground = RequestValidation.normalizeDashboardGridBackground(p.gridBackground)
    )

  /** Trims panelIds only: geometry is NOT normalized here (HEL-1071 owner ruling: reject, never
   *  clamp) — [[LayoutPolicy]] validates it against the stored layout. An empty object is a `400`. */
  private[services] def validateDashboardLayoutPayload(
      layout: Option[DashboardLayoutPatchPayload]
  ): Either[String, Option[LayoutPolicy.Patch]] =
    layout match {
      case None => Right(None)
      case Some(p) =>
        def one(items: Option[Vector[DashboardLayoutItemPayload]]): Either[String, Option[Vector[DashboardLayoutItem]]] =
          items match {
            case None     => Right(None)
            case Some(is) => validateDashboardLayoutItems(is).map(Some(_))
          }
        for {
          lg <- one(p.lg)
          md <- one(p.md)
          sm <- one(p.sm)
          xs <- one(p.xs)
          patch = LayoutPolicy.Patch(lg, md, sm, xs)
          _ <- Either.cond(!patch.isEmpty, (), "layout must include at least one of lg, md, sm, xs")
        } yield Some(patch)
    }

  private[services] def validateDashboardLayoutItems(
      items: Vector[DashboardLayoutItemPayload]
  ): Either[String, Vector[DashboardLayoutItem]] =
    items.foldLeft[Either[String, Vector[DashboardLayoutItem]]](Right(Vector.empty)) {
      case (Left(err), _) => Left(err)
      case (Right(acc), item) =>
        val panelId = item.panelId.trim
        if (panelId.isEmpty) Left("layout panelId is required")
        else Right(acc :+ DashboardLayoutItem(
          panelId = PanelId(panelId),
          x       = item.x,
          y       = item.y,
          w       = item.w,
          h       = item.h
        ))
    }
}
