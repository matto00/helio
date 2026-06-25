package com.helio.infrastructure

import com.helio.api.protocols.{
  DashboardAppearancePayload,
  DashboardLayoutItemPayload,
  DashboardLayoutPayload,
  DashboardSnapshotDashboardEntry,
  DashboardSnapshotPanelEntry,
  DashboardSnapshotPayload
}
import com.helio.domain._
import com.helio.domain.panels._
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.Future

/** Bulk snapshot operations extracted from [[DashboardRepository]] to keep
 *  that file within the 250-line budget. Mixed in via self-type so all
 *  protected members of [[DashboardRepository]] remain accessible. */
trait DashboardSnapshotOps { self: DashboardRepository =>

  /** Privileged duplicate: uses withSystemContext because DashboardService has
   *  confirmed ownership before calling this. New rows are inserted with the
   *  calling user's ownerId so V36 RLS INSERT/SELECT policies apply to the
   *  resulting rows correctly. */
  def duplicate(id: DashboardId, ownerId: UserId): Future[Option[(Dashboard, Vector[Panel])]] = {
    val panelTable = TableQuery[PanelRepository.PanelTable]

    val action = table.filter(_.id === id.value).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some(sourceRow) =>
        panelTable.filter(_.dashboardId === id.value).result.flatMap { panelRows =>
          val now        = Instant.now()
          val newDashId  = UUID.randomUUID().toString
          val idMap      = panelRows.map(p => p.id -> UUID.randomUUID().toString).toMap
          val sourceDash = rowToDomain(sourceRow)

          def remapItems(items: Vector[DashboardLayoutItem]): Vector[DashboardLayoutItem] =
            items.flatMap(item => idMap.get(item.panelId.value).map(nid => item.copy(panelId = PanelId(nid))))

          val newLayout = DashboardLayout(
            lg = remapItems(sourceDash.layout.lg),
            md = remapItems(sourceDash.layout.md),
            sm = remapItems(sourceDash.layout.sm),
            xs = remapItems(sourceDash.layout.xs)
          )
          val newDash = Dashboard(
            id         = DashboardId(newDashId),
            name       = s"${sourceDash.name} (copy)",
            meta       = ResourceMeta(ownerId.value, now, now),
            appearance = sourceDash.appearance,
            layout     = newLayout,
            ownerId    = ownerId
          )

          val newPanelRows: Seq[PanelRepository.PanelRow] =
            panelRows.map(p => p.copy(
              id          = idMap(p.id),
              dashboardId = newDashId,
              createdAt   = now,
              lastUpdated = now,
              ownerId     = UUID.fromString(ownerId.value)
            ))

          val newPanels = newPanelRows.map(panelRowToDomain).toVector

          (table += domainToRow(newDash))
            .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
            .map(_ => Some((newDash, newPanels)))
        }
    }.transactionally

    ctx.withSystemContext(action)
  }

  /** Privileged export: uses withSystemContext because DashboardService has
   *  confirmed ownership before calling this. Export is a read-only operation;
   *  withSystemContext avoids the V36 dashboard SELECT policy predicate for
   *  a path that the service layer has already ACL-checked. */
  def exportSnapshot(id: DashboardId): Future[Option[DashboardSnapshotPayload]] = {
    val panelTable = TableQuery[PanelRepository.PanelTable]

    val action = table.filter(_.id === id.value).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some(sourceRow) =>
        panelTable.filter(_.dashboardId === id.value).result.map { panelRows =>
          val sourceDash = rowToDomain(sourceRow)

          def layoutItemToSnapshot(item: DashboardLayoutItem): DashboardLayoutItemPayload =
            DashboardLayoutItemPayload(
              panelId = item.panelId.value,
              x       = item.x,
              y       = item.y,
              w       = item.w,
              h       = item.h
            )

          val snapshotLayout = DashboardLayoutPayload(
            lg = sourceDash.layout.lg.map(layoutItemToSnapshot),
            md = sourceDash.layout.md.map(layoutItemToSnapshot),
            sm = sourceDash.layout.sm.map(layoutItemToSnapshot),
            xs = sourceDash.layout.xs.map(layoutItemToSnapshot)
          )

          val snapshotPanels = panelRows.toVector.map { p =>
            DashboardSnapshotPanelEntry.fromDomain(panelRowToDomain(p))
          }

          val snapshotDashboard = DashboardSnapshotDashboardEntry(
            name       = sourceDash.name,
            appearance = DashboardAppearancePayload(
              background     = Some(sourceDash.appearance.background),
              gridBackground = Some(sourceDash.appearance.gridBackground)
            ),
            layout = snapshotLayout
          )

          Some(DashboardSnapshotPayload(
            version   = DashboardSnapshotPayload.CurrentVersion,
            dashboard = snapshotDashboard,
            panels    = snapshotPanels
          ))
        }
    }

    ctx.withSystemContext(action)
  }

  /** Privileged import: uses withSystemContext to insert new dashboard and panel
   *  rows on behalf of `ownerId`. New rows carry the correct owner_id so V36
   *  RLS SELECT/UPDATE/DELETE policies apply to them correctly after insertion.
   *  Route-layer ACL check (authenticated user) is enforced before this is called. */
  def importSnapshot(payload: DashboardSnapshotPayload, ownerId: UserId): Future[(Dashboard, Vector[Panel])] = {
    val panelTable = TableQuery[PanelRepository.PanelTable]

    val now       = Instant.now()
    val newDashId = UUID.randomUUID().toString
    val idMap     = payload.panels.map(p => p.snapshotId -> UUID.randomUUID().toString).toMap

    def remapLayoutItem(item: DashboardLayoutItemPayload): Option[DashboardLayoutItem] =
      idMap.get(item.panelId).map(nid =>
        DashboardLayoutItem(panelId = PanelId(nid), x = item.x, y = item.y, w = item.w, h = item.h)
      )

    val newLayout = DashboardLayout(
      lg = payload.dashboard.layout.lg.flatMap(remapLayoutItem),
      md = payload.dashboard.layout.md.flatMap(remapLayoutItem),
      sm = payload.dashboard.layout.sm.flatMap(remapLayoutItem),
      xs = payload.dashboard.layout.xs.flatMap(remapLayoutItem)
    )

    val newDash = Dashboard(
      id         = DashboardId(newDashId),
      name       = payload.dashboard.name,
      meta       = ResourceMeta(ownerId.value, now, now),
      appearance = DashboardAppearance(
        background     = payload.dashboard.appearance.background.getOrElse(DashboardAppearance.Default.background),
        gridBackground = payload.dashboard.appearance.gridBackground.getOrElse(DashboardAppearance.Default.gridBackground)
      ),
      layout  = newLayout,
      ownerId = ownerId
    )

    // CS2c-3c: reconstruct each panel's typed config from the wire `(type, config)`
    // payload via the per-subtype tolerant create-decoder, then build the domain
    // Panel and persist via PanelRowMapper.domainToRow. The pre-CS2c-3c "flat
    // entry fields → row columns" path is gone (snapshot wire shape changed).
    val newPanels: Vector[Panel] = payload.panels.map { entry =>
      val panelId    = PanelId(idMap(entry.snapshotId))
      val dashId     = DashboardId(newDashId)
      val meta       = ResourceMeta(ownerId.value, now, now)
      val appearance = PanelAppearance(
        background   = entry.appearance.background.getOrElse(PanelAppearance.Default.background),
        color        = entry.appearance.color.getOrElse(PanelAppearance.Default.color),
        transparency = entry.appearance.transparency.getOrElse(PanelAppearance.Default.transparency),
        chart        = entry.appearance.chart
      )
      val created = PanelConfigCodec.decodeCreateConfig(entry.`type`, Some(entry.config)) match {
        case Right(c)  => c
        case Left(err) => throw new IllegalArgumentException(s"snapshot panel '${entry.snapshotId}' invalid config: $err")
      }
      created match {
        case PanelConfigCodec.MetricCreate(c)   => MetricPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.ChartCreate(c)    => ChartPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.TableCreate(c)    => TablePanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.TextCreate(c)     => TextPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.MarkdownCreate(c) => MarkdownPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.ImageCreate(c)    => ImagePanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
        case PanelConfigCodec.DividerCreate(c)  => DividerPanel(panelId, dashId, entry.title, meta, appearance, ownerId, c)
      }
    }

    val newPanelRows: Vector[PanelRepository.PanelRow] = newPanels.map(PanelRowMapper.domainToRow)

    val action = (
      (table += domainToRow(newDash))
        .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
        .map(_ => (newDash, newPanels))
    ).transactionally

    ctx.withSystemContext(action)
  }
}
