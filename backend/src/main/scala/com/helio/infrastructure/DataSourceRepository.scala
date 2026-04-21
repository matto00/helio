package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DataSourceRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import DataSourceRepository._

  private val table = TableQuery[DataSourceTable]

  private def rowToDomain(row: DataSourceRow): DataSource =
    DataSource(
      id         = DataSourceId(row.id),
      name       = row.name,
      sourceType = SourceType.fromString(row.sourceType).getOrElse(SourceType.Static),
      config     = spray.json.JsonParser(row.config),
      createdAt  = row.createdAt,
      updatedAt  = row.updatedAt,
      ownerId    = row.ownerId.map(id => UserId(id.toString)).getOrElse(UserId("00000000-0000-0000-0000-000000000000"))
    )

  private def domainToRow(ds: DataSource): DataSourceRow =
    DataSourceRow(
      id         = ds.id.value,
      name       = ds.name,
      sourceType = SourceType.asString(ds.sourceType),
      config     = ds.config.compactPrint,
      createdAt  = ds.createdAt,
      updatedAt  = ds.updatedAt,
      ownerId    = if (ds.ownerId.value.isEmpty) None else Some(UUID.fromString(ds.ownerId.value))
    )

  def findAll(ownerId: UserId): Future[Vector[DataSource]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    db.run(table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result)
      .map(_.map(rowToDomain).toVector)
  }

  /** Unscoped findById — used by AclDirective resolver and internal post-auth route code. */
  def findById(id: DataSourceId): Future[Option[DataSource]] =
    db.run(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  def insert(source: DataSource): Future[DataSource] =
    db.run(table += domainToRow(source))
      .map(_ => source)

  def update(source: DataSource): Future[Option[DataSource]] = {
    val action = table
      .filter(_.id === source.id.value)
      .map(r => (r.name, r.config, r.updatedAt))
      .update((source.name, source.config.compactPrint, source.updatedAt))
      .andThen(table.filter(_.id === source.id.value).result.headOption)
      .map(_.map(rowToDomain))
    db.run(action)
  }

  def delete(id: DataSourceId): Future[Boolean] =
    db.run(table.filter(_.id === id.value).delete).map(_ > 0)
}

object DataSourceRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  case class DataSourceRow(
      id: String,
      name: String,
      sourceType: String,
      config: String,
      createdAt: Instant,
      updatedAt: Instant,
      ownerId: Option[java.util.UUID]
  )

  class DataSourceTable(tag: Tag) extends Table[DataSourceRow](tag, "data_sources") {
    def id         = column[String]("id", O.PrimaryKey)
    def name       = column[String]("name")
    def sourceType = column[String]("source_type")
    def config     = column[String]("config")
    def createdAt  = column[Instant]("created_at")
    def updatedAt  = column[Instant]("updated_at")
    def ownerId    = column[Option[java.util.UUID]]("owner_id")

    def * = (id, name, sourceType, config, createdAt, updatedAt, ownerId).mapTo[DataSourceRow]
  }
}
