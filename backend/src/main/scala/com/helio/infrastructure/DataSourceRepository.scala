package com.helio.infrastructure

import com.helio.api.protocols.DataSourceConfigCodec
import com.helio.domain._
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsObject, JsString, JsonParser}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DataSourceRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import DataSourceRepository._

  private val table = TableQuery[DataSourceTable]

  /** Project a DB row into the typed ADT. Dispatch happens on the
   *  `source_type` column. Unknown kinds raise a loud
   *  `IllegalStateException` so a corrupt row doesn't silently fall through to
   *  `StaticSource` (the previous behaviour). Legacy CSV configs that used
   *  `filePath` are mapped to the new `path` field at read time, preserving
   *  HEL-237's regression fix. */
  private def rowToDomain(row: DataSourceRow): DataSource = {
    val id         = DataSourceId(row.id)
    val ownerId    = row.ownerId.map(uid => UserId(uid.toString)).getOrElse(UserId(""))
    row.sourceType match {
      case DataSourceKind.Csv =>
        val cfg = DataSourceConfigCodec.decodeCsv(row.config)
        CsvSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg)
      case DataSourceKind.RestApi =>
        val cfg = DataSourceConfigCodec.decodeRest(row.config)
        RestSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg)
      case DataSourceKind.Sql =>
        val cfg = DataSourceConfigCodec.decodeSql(row.config)
        SqlSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg)
      case DataSourceKind.Static =>
        StaticSource(id, row.name, ownerId, row.createdAt, row.updatedAt)
      case other =>
        throw new IllegalStateException(s"Unknown data source type in DB: '$other'")
    }
  }

  /** Flatten a typed ADT into a DB row. Each subtype emits its kind string and
   *  serialized config payload. StaticSource stores `{}` to satisfy the
   *  `config` column NOT NULL constraint. */
  private def domainToRow(ds: DataSource): DataSourceRow = {
    val (kind, configJson) = ds match {
      case c: CsvSource    => (DataSourceKind.Csv,     DataSourceConfigCodec.encodeCsv(c.config))
      case r: RestSource   => (DataSourceKind.RestApi, DataSourceConfigCodec.encodeRest(r.config))
      case s: SqlSource    => (DataSourceKind.Sql,     DataSourceConfigCodec.encodeSql(s.config))
      case _: StaticSource => (DataSourceKind.Static,  "{}")
    }
    DataSourceRow(
      id         = ds.id.value,
      name       = ds.name,
      sourceType = kind,
      config     = configJson,
      createdAt  = ds.createdAt,
      updatedAt  = ds.updatedAt,
      ownerId    = if (ds.ownerId.value.isEmpty) None else Some(UUID.fromString(ds.ownerId.value))
    )
  }

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

  /** Update name + config + updatedAt. The `source_type` column is immutable
   *  (the discriminator is part of identity); subtype changes go through a
   *  delete-then-insert flow. The config JSON re-derives per subtype. */
  def update(source: DataSource): Future[Option[DataSource]] = {
    val configJson = source match {
      case c: CsvSource    => DataSourceConfigCodec.encodeCsv(c.config)
      case r: RestSource   => DataSourceConfigCodec.encodeRest(r.config)
      case s: SqlSource    => DataSourceConfigCodec.encodeSql(s.config)
      case _: StaticSource => "{}"
    }
    val action = table
      .filter(_.id === source.id.value)
      .map(r => (r.name, r.config, r.updatedAt))
      .update((source.name, configJson, source.updatedAt))
      .andThen(table.filter(_.id === source.id.value).result.headOption)
      .map(_.map(rowToDomain))
    db.run(action)
  }

  /** Update only the static-source config payload + updatedAt + datatype
   *  schema in callers; this method handles the source row only. The config
   *  payload is provided as a raw `{columns, rows}` `JsObject` so the
   *  StaticSource ADT can stay flat (no per-row payload field). */
  def updateStaticPayload(id: DataSourceId, name: String, payload: JsObject, updatedAt: Instant): Future[Option[DataSource]] = {
    val action = table
      .filter(_.id === id.value)
      .map(r => (r.name, r.config, r.updatedAt))
      .update((name, payload.compactPrint, updatedAt))
      .andThen(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))
    db.run(action)
  }

  /** Read the raw stored `config` JSON for a StaticSource (or any source) —
   *  used by the in-process engine / Spark submitter, which still consume the
   *  `{columns, rows}` blob directly rather than reifying a typed payload. */
  def readRawConfig(id: DataSourceId): Future[Option[String]] =
    db.run(table.filter(_.id === id.value).map(_.config).result.headOption)

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
      ownerId: Option[UUID]
  )

  class DataSourceTable(tag: Tag) extends Table[DataSourceRow](tag, "data_sources") {
    def id         = column[String]("id", O.PrimaryKey)
    def name       = column[String]("name")
    def sourceType = column[String]("source_type")
    def config     = column[String]("config")
    def createdAt  = column[Instant]("created_at")
    def updatedAt  = column[Instant]("updated_at")
    def ownerId    = column[Option[UUID]]("owner_id")

    def * = (id, name, sourceType, config, createdAt, updatedAt, ownerId).mapTo[DataSourceRow]
  }

  /** Read the static-source `{columns, rows}` payload. Used by the in-process
   *  engine + Spark submitter (which consume the raw blob directly) and by the
   *  protocol layer's StaticSource response materialization. */
  def parseStaticPayload(raw: String): JsObject =
    JsonParser(raw) match {
      case obj: JsObject => obj
      case _             => JsObject.empty
    }

  /** Read the CSV path from a stored config string. Tolerates both the
   *  current `path` key and the legacy `filePath` key (HEL-237 regression
   *  fix). Returns `None` if neither is present. */
  def csvPathFromRawConfig(raw: String): Option[String] =
    JsonParser(raw) match {
      case obj: JsObject =>
        obj.fields.get("path").orElse(obj.fields.get("filePath")).collect {
          case JsString(p) => p
        }
      case _ => None
    }
}
