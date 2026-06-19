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

  private[services] def normalizeAppearance(p: DashboardAppearancePayload): DashboardAppearance =
    DashboardAppearance(
      background     = RequestValidation.normalizeDashboardBackground(p.background),
      gridBackground = RequestValidation.normalizeDashboardGridBackground(p.gridBackground)
    )

  private[services] def validateDashboardLayoutPayload(
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
          x       = RequestValidation.normalizeLayoutCoordinate(item.x),
          y       = RequestValidation.normalizeLayoutCoordinate(item.y),
          w       = RequestValidation.normalizeLayoutSpan(item.w),
          h       = RequestValidation.normalizeLayoutSpan(item.h)
        ))
    }
}
