package com.helio.infrastructure

import com.helio.api.JsonProtocols
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
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
      updatedAt      = row.updatedAt
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
      updatedAt      = dt.updatedAt
    )

  def findAll(): Future[Vector[DataType]] =
    db.run(table.sortBy(_.createdAt.desc).result)
      .map(_.map(rowToDomain).toVector)

  def findBySourceId(id: DataSourceId): Future[Vector[DataType]] =
    db.run(table.filter(_.sourceId === id.value).result)
      .map(_.map(rowToDomain).toVector)

  def findById(id: DataTypeId): Future[Option[DataType]] =
    db.run(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

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
      updatedAt: Instant
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

    def * = (id, sourceId, name, fields, computedFields, version, createdAt, updatedAt).mapTo[DataTypeRow]
  }
}
