package com.helio.infrastructure

import com.helio.api.JsonProtocols
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
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

  def count(): Future[Int] =
    db.run(table.length.result)
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
