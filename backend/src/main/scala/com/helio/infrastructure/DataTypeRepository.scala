package com.helio.infrastructure

import com.helio.api.JsonProtocols
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DataTypeRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  import DataTypeRepository._

  private val table = TableQuery[DataTypeTable]

  private def rowToDomain(row: DataTypeRow): DataType =
    DataType(
      id             = DataTypeId(row.id),
      sourceId       = row.sourceId.map(DataSourceId(_)),
      name           = row.name,
      fields         = row.fields.parseJson.convertTo[Vector[DataField]],
      computedFields = row.computedFields.parseJson.convertTo[Vector[ComputedField]],
      version        = row.version,
      createdAt      = row.createdAt,
      updatedAt      = row.updatedAt,
      ownerId        = row.ownerId.map(id => UserId(id.toString)).getOrElse(UserId("00000000-0000-0000-0000-000000000000"))
    )

  private def domainToRow(dt: DataType): DataTypeRow =
    DataTypeRow(
      id             = dt.id.value,
      sourceId       = dt.sourceId.map(_.value),
      name           = dt.name,
      fields         = dt.fields.toJson.compactPrint,
      computedFields = dt.computedFields.toJson.compactPrint,
      version        = dt.version,
      createdAt      = dt.createdAt,
      updatedAt      = dt.updatedAt,
      ownerId        = if (dt.ownerId.value.isEmpty) None else Some(UUID.fromString(dt.ownerId.value))
    )

  def findAll(ownerId: UserId): Future[Vector[DataType]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    db.run(table.filter(_.ownerId === ownerUuid).sortBy(_.createdAt.desc).result)
      .map(_.map(rowToDomain).toVector)
  }

  def findBySourceId(id: DataSourceId, ownerId: UserId): Future[Vector[DataType]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    db.run(table.filter(r => r.sourceId === id.value && r.ownerId === ownerUuid).result)
      .map(_.map(rowToDomain).toVector)
  }

  /** Unscoped findById — used by AclDirective resolver and internal post-auth route code. */
  def findById(id: DataTypeId): Future[Option[DataType]] =
    db.run(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  /** Owner-scoped findById — returns None if the type exists but belongs to a different user.
   *  Used to null-out cross-user typeId bindings on panel reads. */
  def findById(id: DataTypeId, ownerId: UserId): Future[Option[DataType]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    db.run(table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption)
      .map(_.map(rowToDomain))
  }

  def insert(dt: DataType): Future[DataType] = {
    val row = domainToRow(dt).copy(version = 1)
    db.run(table += row).map(_ => rowToDomain(row))
  }

  def update(dt: DataType): Future[Option[DataType]] = {
    val action = table
      .filter(_.id === dt.id.value)
      .result
      .headOption
      .flatMap {
        case None => DBIO.successful(None)
        case Some(existing) =>
          val newVersion = existing.version + 1
          table
            .filter(_.id === dt.id.value)
            .map(r => (r.sourceId, r.name, r.fields, r.computedFields, r.version, r.updatedAt))
            .update((
              dt.sourceId.map(_.value),
              dt.name,
              dt.fields.toJson.compactPrint,
              dt.computedFields.toJson.compactPrint,
              newVersion,
              dt.updatedAt
            ))
            .andThen(table.filter(_.id === dt.id.value).result.headOption)
            .map(_.map(rowToDomain))
      }
      .transactionally

    db.run(action)
  }

  def delete(id: DataTypeId): Future[Boolean] =
    db.run(table.filter(_.id === id.value).delete).map(_ > 0)

  def isBoundToAnyPanel(id: DataTypeId): Future[Boolean] =
    db.run(sql"SELECT COUNT(*) FROM panels WHERE type_id = ${id.value}".as[Int].head)
      .map(_ > 0)
}

object DataTypeRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  case class DataTypeRow(
      id: String,
      sourceId: Option[String],
      name: String,
      fields: String,
      computedFields: String,
      version: Int,
      createdAt: Instant,
      updatedAt: Instant,
      ownerId: Option[java.util.UUID]
  )

  class DataTypeTable(tag: Tag) extends Table[DataTypeRow](tag, "data_types") {
    def id             = column[String]("id", O.PrimaryKey)
    def sourceId       = column[Option[String]]("source_id")
    def name           = column[String]("name")
    def fields         = column[String]("fields")
    def computedFields = column[String]("computed_fields")
    def version        = column[Int]("version")
    def createdAt      = column[Instant]("created_at")
    def updatedAt      = column[Instant]("updated_at")
    def ownerId        = column[Option[java.util.UUID]]("owner_id")

    def * = (id, sourceId, name, fields, computedFields, version, createdAt, updatedAt, ownerId).mapTo[DataTypeRow]
  }
}
