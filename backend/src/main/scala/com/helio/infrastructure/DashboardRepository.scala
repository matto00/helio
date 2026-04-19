package com.helio.infrastructure

import com.helio.api.{DashboardSnapshotDashboardEntry, DashboardSnapshotPanelEntry, DashboardSnapshotPayload, JsonProtocols}
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DashboardRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  import DashboardRepository._

  private val table = TableQuery[DashboardTable]

  private def panelRowToDomain(row: PanelRepository.PanelRow): Panel =
    Panel(
      id           = PanelId(row.id),
      dashboardId  = DashboardId(row.dashboardId),
      title        = row.title,
      meta         = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated),
      appearance   = row.appearance.parseJson.convertTo[PanelAppearance],
      panelType    = PanelType.fromString(row.panelType).getOrElse(PanelType.Default),
      ownerId      = UserId(row.ownerId.toString),
      typeId       = row.typeId.map(DataTypeId(_)),
      fieldMapping = row.fieldMapping.map(_.parseJson)
    )

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

          def layoutItemToSnapshot(item: DashboardLayoutItem): com.helio.api.DashboardLayoutItemPayload =
            com.helio.api.DashboardLayoutItemPayload(
              panelId = item.panelId.value,
              x = item.x,
              y = item.y,
              w = item.w,
              h = item.h
            )

          val snapshotLayout = com.helio.api.DashboardLayoutPayload(
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
            appearance = com.helio.api.DashboardAppearancePayload(
              background     = Some(sourceDash.appearance.background),
              gridBackground = Some(sourceDash.appearance.gridBackground)
            ),
            layout = snapshotLayout
          )

          Some(DashboardSnapshotPayload(
            version   = 1,
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

    def remapLayoutItem(item: com.helio.api.DashboardLayoutItemPayload): Option[DashboardLayoutItem] =
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

    val newPanelRows: Vector[PanelRepository.PanelRow] = payload.panels.map { entry =>
      val panelType = PanelType.fromString(entry.`type`).getOrElse(PanelType.Default)
      PanelRepository.PanelRow(
        id          = idMap(entry.snapshotId),
        dashboardId = newDashId,
        title       = entry.title,
        createdBy   = ownerId.value,
        createdAt   = now,
        lastUpdated = now,
        appearance  = PanelAppearance(
          background   = entry.appearance.background.getOrElse(PanelAppearance.Default.background),
          color        = entry.appearance.color.getOrElse(PanelAppearance.Default.color),
          transparency = entry.appearance.transparency.getOrElse(PanelAppearance.Default.transparency)
        ).toJson.compactPrint,
        panelType   = PanelType.asString(panelType),
        typeId      = entry.typeId,
        fieldMapping = entry.fieldMapping.map(_.compactPrint),
        ownerId      = UUID.fromString(ownerId.value)
      )
    }

    val newPanels = newPanelRows.map(panelRowToDomain)

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
      ownerId: java.util.UUID
  )

  class DashboardTable(tag: Tag) extends Table[DashboardRow](tag, "dashboards") {
    def id          = column[String]("id", O.PrimaryKey)
    def name        = column[String]("name")
    def createdBy   = column[String]("created_by")
    def createdAt   = column[Instant]("created_at")
    def lastUpdated = column[Instant]("last_updated")
    def appearance  = column[String]("appearance")
    def layout      = column[String]("layout")
    def ownerId     = column[java.util.UUID]("owner_id")

    def * = (id, name, createdBy, createdAt, lastUpdated, appearance, layout, ownerId).mapTo[DashboardRow]
  }
}
