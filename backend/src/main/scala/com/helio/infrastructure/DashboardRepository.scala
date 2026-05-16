package com.helio.infrastructure

import com.helio.api.protocols.{DashboardAppearancePayload, DashboardLayoutItemPayload, DashboardLayoutPayload, DashboardProtocol, DashboardSnapshotDashboardEntry, DashboardSnapshotPanelEntry, DashboardSnapshotPayload, PanelProtocol}
import com.helio.domain._
import com.helio.domain.panels._
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DashboardRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext)
    extends DashboardProtocol with PanelProtocol {

  import DashboardRepository._

  private val table = TableQuery[DashboardTable]

  private def panelRowToDomain(row: PanelRepository.PanelRow): Panel =
    PanelRowMapper.rowToDomain(row)

  private def rowToDomain(row: DashboardRow): Dashboard =
    Dashboard(
      id         = DashboardId(row.id),
      name       = row.name,
      meta       = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated),
      appearance = row.appearance.parseJson.convertTo[DashboardAppearance],
      layout     = row.layout.parseJson.convertTo[DashboardLayout],
      ownerId    = UserId(row.ownerId.toString)
    )

  private def domainToRow(d: Dashboard): DashboardRow =
    DashboardRow(
      id          = d.id.value,
      name        = d.name,
      createdBy   = d.meta.createdBy,
      createdAt   = d.meta.createdAt,
      lastUpdated = d.meta.lastUpdated,
      appearance  = d.appearance.toJson.compactPrint,
      layout      = d.layout.toJson.compactPrint,
      ownerId     = UUID.fromString(d.ownerId.value)
    )

  def findAll(ownerId: UserId): Future[Vector[Dashboard]] =
    db.run(table.filter(_.ownerId === UUID.fromString(ownerId.value)).sortBy(_.lastUpdated.desc).result)
      .map(_.map(rowToDomain).toVector)

  def findById(id: DashboardId): Future[Option[Dashboard]] =
    db.run(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  def insert(dashboard: Dashboard): Future[Dashboard] =
    db.run(table += domainToRow(dashboard))
      .map(_ => dashboard)

  def update(dashboard: Dashboard): Future[Option[Dashboard]] =
    db.run(
      table
        .filter(_.id === dashboard.id.value)
        .map(r => (r.name, r.lastUpdated, r.appearance, r.layout))
        .update((
          dashboard.name,
          dashboard.meta.lastUpdated,
          dashboard.appearance.toJson.compactPrint,
          dashboard.layout.toJson.compactPrint
        ))
    ).map(count => if (count > 0) Some(dashboard) else None)

  def updateName(id: DashboardId, name: String, lastUpdated: Instant): Future[Option[Dashboard]] =
    db.run(
      table
        .filter(_.id === id.value)
        .map(r => (r.name, r.lastUpdated))
        .update((name, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  def delete(id: DashboardId): Future[Boolean] =
    db.run(table.filter(_.id === id.value).delete).map(_ > 0)

  def count(): Future[Int] =
    db.run(table.length.result)

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
            panelRows.map(p => p.copy(id = idMap(p.id), dashboardId = newDashId, createdAt = now, lastUpdated = now, ownerId = UUID.fromString(ownerId.value)))

          val newPanels = newPanelRows.map(panelRowToDomain).toVector

          (table += domainToRow(newDash))
            .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
            .map(_ => Some((newDash, newPanels)))
        }
    }.transactionally

    db.run(action)
  }

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
              x = item.x,
              y = item.y,
              w = item.w,
              h = item.h
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

    db.run(action)
  }

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
      val panelId   = PanelId(idMap(entry.snapshotId))
      val dashId    = DashboardId(newDashId)
      val meta      = ResourceMeta(ownerId.value, now, now)
      val appearance = PanelAppearance(
        background   = entry.appearance.background.getOrElse(PanelAppearance.Default.background),
        color        = entry.appearance.color.getOrElse(PanelAppearance.Default.color),
        transparency = entry.appearance.transparency.getOrElse(PanelAppearance.Default.transparency),
        chart        = entry.appearance.chart
      )
      val created = PanelConfigCodec.decodeCreateConfig(entry.`type`, Some(entry.config)) match {
        case Right(c) => c
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

    db.run(action)
  }
}

object DashboardRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  case class DashboardRow(
      id: String,
      name: String,
      createdBy: String,
      createdAt: Instant,
      lastUpdated: Instant,
      appearance: String,
      layout: String,
      ownerId: UUID
  )

  class DashboardTable(tag: Tag) extends Table[DashboardRow](tag, "dashboards") {
    def id          = column[String]("id", O.PrimaryKey)
    def name        = column[String]("name")
    def createdBy   = column[String]("created_by")
    def createdAt   = column[Instant]("created_at")
    def lastUpdated = column[Instant]("last_updated")
    def appearance  = column[String]("appearance")
    def layout      = column[String]("layout")
    def ownerId     = column[UUID]("owner_id")

    def * = (id, name, createdBy, createdAt, lastUpdated, appearance, layout, ownerId).mapTo[DashboardRow]
  }
}
