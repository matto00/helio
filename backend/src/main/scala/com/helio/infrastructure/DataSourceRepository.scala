package com.helio.infrastructure

import com.helio.api.protocols.DataSourceConfigCodec
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsObject, JsString, JsonParser}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class DataSourceRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

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
      case DataSourceKind.Text =>
        val cfg = DataSourceConfigCodec.decodeText(row.config)
        TextSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg)
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
      case t: TextSource   => (DataSourceKind.Text,    DataSourceConfigCodec.encodeText(t.config))
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

  def findAll(ownerId: UserId, page: Page): Future[PagedResult[DataSource]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val baseQuery = table.filter(_.ownerId === ownerUuid)
    val countAction = baseQuery.length.result
    val sliceAction = baseQuery.sortBy(_.createdAt.desc).drop(page.offset).take(page.limit).result
    ctx.withUserContext(ownerId.value)(
      for {
        total <- countAction
        rows  <- sliceAction
      } yield PagedResult(rows.map(rowToDomain).toVector, total, page.offset, page.limit)
    )
  }

  /** Privileged unscoped read — no ACL check.
   *
   *  Permitted callers:
   *  - `ResourceTypeRegistry` resolver (resolves owner FOR the ACL check)
   *  - `PipelineRunService.submit` / `previewStep` (pipeline ACL is the gate)
   *  - `SparkJobSubmitter.applyStep` (JoinStep, background privileged path)
   *  - `InProcessPipelineEngine` step execution (ditto)
   *  - `DataTypeService.checkSourceLink` (error-message rendering only, no data leak) */
  def findByIdInternal(id: DataSourceId): Future[Option[DataSource]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  /** HEL-265 CS2 seed: owner-scoped read. Introduced here so
    * `PipelineRepository.create` can verify the caller owns the source they
    * bind the new pipeline to. CS3 will broaden adoption across the
    * DataSourceService / SourceService surface and rename the unscoped
    * `findById` to `findByIdInternal`.
    *
    * Returns `None` for rows the caller does not own (existence and
    * authorization are indistinguishable at the API). */
  def findByIdOwned(id: DataSourceId, user: AuthenticatedUser): Future[Option[DataSource]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** Insert a new data source row in user context.
   *
   *  The V35 RLS policy on `data_sources` evaluates `owner_id` against
   *  `app.current_user_id`, which `withUserContext` sets via SET LOCAL.
   *  The row's `owner_id` must equal `user.id` — callers are responsible for
   *  building the `DataSource` with the correct `ownerId` before calling this. */
  def insert(source: DataSource, user: AuthenticatedUser): Future[DataSource] =
    ctx.withUserContext(user.id.value)(table += domainToRow(source))
      .map(_ => source)

  /** Update name + config + updatedAt in user context.
   *
   *  The `source_type` column is immutable (discriminator is part of identity);
   *  subtype changes go through a delete-then-insert flow. The V35 RLS USING
   *  clause on `data_sources` restricts this update to rows owned by the caller,
   *  adding a DB-layer backstop to the app-layer ACL enforced before this call. */
  def update(source: DataSource, user: AuthenticatedUser): Future[Option[DataSource]] = {
    val configJson = source match {
      case c: CsvSource    => DataSourceConfigCodec.encodeCsv(c.config)
      case r: RestSource   => DataSourceConfigCodec.encodeRest(r.config)
      case s: SqlSource    => DataSourceConfigCodec.encodeSql(s.config)
      case _: StaticSource => "{}"
      case t: TextSource   => DataSourceConfigCodec.encodeText(t.config)
    }
    val action = table
      .filter(_.id === source.id.value)
      .map(r => (r.name, r.config, r.updatedAt))
      .update((source.name, configJson, source.updatedAt))
      .andThen(table.filter(_.id === source.id.value).result.headOption)
      .map(_.map(rowToDomain))
    ctx.withUserContext(user.id.value)(action)
  }

  /** Update only the static-source config payload + updatedAt in user context.
   *
   *  The payload is a raw `{columns, rows}` `JsObject` so the StaticSource ADT
   *  stays flat. The V35 RLS policy restricts this write to rows owned by the
   *  caller — the ownership check happens at the DB layer as well as in the
   *  service layer before this call. */
  def updateStaticPayload(id: DataSourceId, name: String, payload: JsObject, updatedAt: Instant, user: AuthenticatedUser): Future[Option[DataSource]] = {
    val action = table
      .filter(_.id === id.value)
      .map(r => (r.name, r.config, r.updatedAt))
      .update((name, payload.compactPrint, updatedAt))
      .andThen(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))
    ctx.withUserContext(user.id.value)(action)
  }

  /** Read the raw stored `config` JSON for a StaticSource (or any source).
   *
   *  Privileged: callers are background engine paths (pipeline ACL is the gate
   *  at submission) or system paths without a user context. Bypasses RLS via
   *  the privileged pool, which is correct for these callers. */
  def readRawConfig(id: DataSourceId): Future[Option[String]] =
    ctx.withSystemContext(table.filter(_.id === id.value).map(_.config).result.headOption)

  /** Delete a data source row in user context.
   *
   *  The V35 RLS USING clause restricts this DELETE to rows owned by the caller
   *  (`app.current_user_id` == `owner_id`), adding a DB-layer backstop.
   *  The app-layer ACL check (`findByIdOwned`) is still performed by callers
   *  before this method is invoked. */
  def delete(id: DataSourceId, user: AuthenticatedUser): Future[Boolean] =
    ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).delete).map(_ > 0)
}

object DataSourceRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Maps Scala String ↔ PostgreSQL JSONB. The PostgreSQL JDBC driver accepts
   *  setString / getString for JSONB columns, so the conversion is identity at
   *  the Scala level; the type exists to mark JSONB-backed columns explicitly
   *  in table definitions. */
  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

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
    def config     = column[String]("config")(jsonbStringType)
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
