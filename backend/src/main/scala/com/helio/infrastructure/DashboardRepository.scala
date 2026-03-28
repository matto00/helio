package com.helio.infrastructure

import com.helio.api.JsonProtocols
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

  private def rowToDomain(row: DashboardRow): Dashboard =
    Dashboard(
      id         = DashboardId(row.id),
      name       = row.name,
      meta       = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated),
      appearance = row.appearance.parseJson.convertTo[DashboardAppearance],
      layout     = row.layout.parseJson.convertTo[DashboardLayout]
    )

  private def domainToRow(d: Dashboard): DashboardRow =
    DashboardRow(
      id          = d.id.value,
      name        = d.name,
      createdBy   = d.meta.createdBy,
      createdAt   = d.meta.createdAt,
      lastUpdated = d.meta.lastUpdated,
      appearance  = d.appearance.toJson.compactPrint,
      layout      = d.layout.toJson.compactPrint
    )

  def findAll(): Future[Vector[Dashboard]] =
    db.run(table.sortBy(_.lastUpdated.desc).result)
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

  def duplicate(id: DashboardId): Future[Option[(Dashboard, Vector[Panel])]] = {
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
            meta       = ResourceMeta("system", now, now),
            appearance = sourceDash.appearance,
            layout     = newLayout
          )

          val newPanelRows: Seq[PanelRepository.PanelRow] =
            panelRows.map(p => p.copy(id = idMap(p.id), dashboardId = newDashId, createdAt = now, lastUpdated = now))

          def panelRowToDomain(row: PanelRepository.PanelRow): Panel =
            Panel(
              id           = PanelId(row.id),
              dashboardId  = DashboardId(row.dashboardId),
              title        = row.title,
              meta         = ResourceMeta(row.createdBy, row.createdAt, row.lastUpdated),
              appearance   = row.appearance.parseJson.convertTo[PanelAppearance],
              panelType    = PanelType.fromString(row.panelType).getOrElse(PanelType.Default),
              typeId       = row.typeId.map(DataTypeId(_)),
              fieldMapping = row.fieldMapping.map(_.parseJson)
            )

          val newPanels = newPanelRows.map(panelRowToDomain).toVector

          (table += domainToRow(newDash))
            .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
            .map(_ => Some((newDash, newPanels)))
        }
    }.transactionally

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
      layout: String
  )

  class DashboardTable(tag: Tag) extends Table[DashboardRow](tag, "dashboards") {
    def id          = column[String]("id", O.PrimaryKey)
    def name        = column[String]("name")
    def createdBy   = column[String]("created_by")
    def createdAt   = column[Instant]("created_at")
    def lastUpdated = column[Instant]("last_updated")
    def appearance  = column[String]("appearance")
    def layout      = column[String]("layout")

    def * = (id, name, createdBy, createdAt, lastUpdated, appearance, layout).mapTo[DashboardRow]
  }
}
