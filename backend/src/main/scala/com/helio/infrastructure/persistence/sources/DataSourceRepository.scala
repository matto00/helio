package com.helio.infrastructure.persistence.sources

import com.helio.infrastructure.persistence.DbContext
import com.helio.api.protocols.sources.DataSourceConfigCodec
import com.helio.domain.model._
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsObject, JsString, JsonParser}

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContext, Future}

class DataSourceRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import DataSourceRepository._

  private val log = LoggerFactory.getLogger(getClass)

  private val table = TableQuery[DataSourceTable]

  // HEL-822 design.md Decision 6 revised (CR5): once-per-process `warn` logging for a
  // sentinel-decoded row, keyed by source id, to avoid log-spamming every list call.
  private val warnedRowIds = ConcurrentHashMap.newKeySet[String]()

  private def warnOnce(sourceId: String, reason: String): Unit =
    if (warnedRowIds.add(sourceId))
      log.warn("rest_api data source {} decoded to a sentinel config ({}): row still listed, fetch will fail fast", sourceId, reason)

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
        CsvSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag)
      case DataSourceKind.RestApi =>
        val cfg = DataSourceConfigCodec.decodeRest(row.config) match {
          case Right(c) => c
          case Left(reason) =>
            // HEL-822 design.md Decision 6 revised (CR5): neither drop the row (it would
            // vanish from GET /api/sources) nor throw (one bad row fails the whole list
            // call). Sentinel `connectorId` fails fast at the Connector-resolution step on
            // any subsequent fetch/preview/refresh attempt (task 2.3), never silently
            // succeeding against nothing.
            val sentinel = if (reason == "legacy-unmigrated") "__unmigrated__" else "__malformed__"
            warnOnce(id.value, reason)
            RestApiConfig(connectorId = sentinel)
        }
        RestSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag)
      case DataSourceKind.Sql =>
        val cfg = DataSourceConfigCodec.decodeSql(row.config)
        SqlSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag)
      case DataSourceKind.Static =>
        StaticSource(id, row.name, ownerId, row.createdAt, row.updatedAt, row.tag)
      case DataSourceKind.Text =>
        val cfg = DataSourceConfigCodec.decodeText(row.config)
        TextSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag)
      case DataSourceKind.Pdf =>
        val cfg = DataSourceConfigCodec.decodePdf(row.config)
        PdfSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag)
      case DataSourceKind.Image =>
        val cfg = DataSourceConfigCodec.decodeImage(row.config)
        ImageSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag)
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
      case p: PdfSource    => (DataSourceKind.Pdf,     DataSourceConfigCodec.encodePdf(p.config))
      case i: ImageSource  => (DataSourceKind.Image,   DataSourceConfigCodec.encodeImage(i.config))
    }
    DataSourceRow(
      id         = ds.id.value,
      name       = ds.name,
      sourceType = kind,
      config     = configJson,
      createdAt  = ds.createdAt,
      updatedAt  = ds.updatedAt,
      ownerId    = if (ds.ownerId.value.isEmpty) None else Some(UUID.fromString(ds.ownerId.value)),
      tag        = ds.tag
    )
  }

  /** Owner-scoped, paginated list, optionally exact-matched on `tag` (HEL-366
   *  tasks.md 2.5). `tag = None` is the pre-existing unfiltered behavior. */
  def findAll(ownerId: UserId, page: Page, tag: Option[String] = None): Future[PagedResult[DataSource]] = {
    val ownerUuid = UUID.fromString(ownerId.value)
    val baseQuery = tag match {
      case Some(t) => table.filter(r => r.ownerId === ownerUuid && r.tag === t)
      case None    => table.filter(_.ownerId === ownerUuid)
    }
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
      case p: PdfSource    => DataSourceConfigCodec.encodePdf(p.config)
      case i: ImageSource  => DataSourceConfigCodec.encodeImage(i.config)
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

  /** HEL-822 design.md Decision 5 (revised, skeptic round 4 CR2): the `dependentCount` seam's
   *  real implementation — no `user` parameter, since by the time it runs inside
   *  `ConnectorRepository.delete`, ownership of the Connector has already been verified
   *  (`findByIdOwned`), and a `data_sources` row can only ever be created referencing a
   *  `connectorId` the creating user already owns — so any row whose
   *  `config->>'connectorId'` matches is guaranteed, by construction, to belong to the same
   *  owner. Runs under `ctx.withSystemContext` (the privileged pool) — safe here because it
   *  returns only a count, never row content. */
  def countRestSourcesReferencing(connectorId: ConnectorId): Future[Int] = {
    // JSONB-extract `config->>'connectorId'` — plain Slick (not slick-pg) has no typed JSONB
    // operator over this String-mapped column, so this is a targeted raw-SQL query rather than
    // a Slick query-DSL filter.
    val action = sql"""select count(*) from data_sources
                        where source_type = ${DataSourceKind.RestApi}
                          and config ->> 'connectorId' = ${connectorId.value}""".as[Int].head
    ctx.withSystemContext(action)
  }

  /** HEL-822 design.md Decision 7 (revised, round-3 CR6 — corrects the earlier design's
   *  reference to a non-existent `updateConfig`). Used ONLY by the startup migration
   *  (`RestSourceConnectorMigration`), never by any request-driven path — runs under
   *  `ctx.withSystemContext` (privileged pool, no request-scoped user available), an
   *  explicit, named RLS-context choice for a credential-bearing migration. */
  /** HEL-822: all `rest_api` rows, regardless of owner, raw config — feeds
   *  `RestSourceConnectorMigration`'s startup scan. Privileged (system context); the
   *  migration itself decides per-row whether/how to touch a row (owned, ownerless,
   *  malformed, already-migrated). */
  def findAllRestApiRawInternal(): Future[Vector[(String, Option[UUID], String, String)]] =
    ctx.withSystemContext(table.filter(_.sourceType === DataSourceKind.RestApi).result)
      .map(_.map(r => (r.id, r.ownerId, r.name, r.config)).toVector)

  def updateConfigInternal(id: DataSourceId, config: String): Future[Boolean] =
    ctx.withSystemContext(
      table.filter(_.id === id.value).map(r => (r.config, r.updatedAt)).update((config, Instant.now()))
    ).map(_ > 0)
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
      ownerId: Option[UUID],
      tag: Option[String] = None
  )

  // Constructor param renamed `slickTag` (not `tag`) — this table declares its
  // own `tag` *column* (HEL-366), which would otherwise shadow Slick's own
  // `Tag` constructor parameter of the same name.
  class DataSourceTable(slickTag: Tag) extends Table[DataSourceRow](slickTag, "data_sources") {
    def id         = column[String]("id", O.PrimaryKey)
    def name       = column[String]("name")
    def sourceType = column[String]("source_type")
    def config     = column[String]("config")(jsonbStringType)
    def createdAt  = column[Instant]("created_at")
    def updatedAt  = column[Instant]("updated_at")
    def ownerId    = column[Option[UUID]]("owner_id")
    def tag        = column[Option[String]]("tag")

    def * = (id, name, sourceType, config, createdAt, updatedAt, ownerId, tag).mapTo[DataSourceRow]
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
