package com.helio.services.dashboards

import com.helio.api.http.RequestValidation
import com.helio.api.protocols.dashboards.{DashboardAppearancePayload, DashboardLayoutItemPayload, DashboardLayoutPatchPayload, DashboardSnapshotPanelEntry, DashboardSnapshotPayload, UpdateDashboardRequest}
import com.helio.domain.model._
import com.helio.domain.panels.PanelConfigCodec
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutPolicy, LayoutValidator}

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
      _ <- validateImportedLayoutGeometry(payload)
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

  /** HEL-1071 (D7): an imported dashboard has no stored layout, so every supplied breakpoint is
   *  "changed" and must be in bounds and non-overlapping, else `400` naming the breakpoint and the
   *  snapshot panel ids. A dashboard exported while holding a bad breakpoint cannot be imported
   *  until that breakpoint is fixed (accepted trade-off, see design.md D7). */
  private[services] def validateImportedLayoutGeometry(payload: DashboardSnapshotPayload): Either[String, Unit] = {
    val l = payload.dashboard.layout
    def items(ps: Vector[DashboardLayoutItemPayload]): Vector[DashboardLayoutItem] =
      ps.map(DashboardLayoutItemPayload.toDomain)
    val patch = LayoutPolicy.Patch(Some(items(l.lg)), Some(items(l.md)), Some(items(l.sm)), Some(items(l.xs)))
    val vs    = LayoutPolicy.violations(DashboardLayout.Default, patch)
    if (vs.isEmpty) Right(()) else Left(LayoutPolicy.message(vs))
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
