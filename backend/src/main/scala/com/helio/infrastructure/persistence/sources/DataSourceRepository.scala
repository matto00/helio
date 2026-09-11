package com.helio.infrastructure.persistence.sources

import com.helio.infrastructure.persistence.DbContext
import com.helio.api.protocols.sources.DataSourceConfigCodec
import com.helio.domain.engine.SchemaField
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.domain.model._
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

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
   *  `DatasetSource`. Legacy CSV configs that used
   *  `filePath` are mapped to the new `path` field at read time, preserving
   *  HEL-237's regression fix. */
  private def rowToDomain(row: DataSourceRow): DataSource = {
    val id         = DataSourceId(row.id)
    val ownerId    = row.ownerId.map(uid => UserId(uid.toString)).getOrElse(UserId(""))
    row.sourceType match {
      case DataSourceKind.Csv =>
        val cfg = DataSourceConfigCodec.decodeCsv(row.config)
        CsvSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag, row.inferredSchema)
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
        RestSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag, row.inferredSchema)
      case DataSourceKind.Sql =>
        val cfg = DataSourceConfigCodec.decodeSql(row.config)
        SqlSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag, row.inferredSchema)
      case DataSourceKind.Static | DataSourceKind.Dataset =>
        // HEL-1074 migrated every stored `source_type` value from "static" to "dataset"; the
        // `DataSourceKind.Static` arm here is defensive only (no row is ever stored as "static"
        // post-migration/HEL-1073's rename) and is retained until that literal is fully retired.
        DatasetSource(id, row.name, ownerId, row.createdAt, row.updatedAt, row.tag, row.inferredSchema)
      case DataSourceKind.Text =>
        val cfg = DataSourceConfigCodec.decodeText(row.config)
        TextSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag, row.inferredSchema)
      case DataSourceKind.Pdf =>
        val cfg = DataSourceConfigCodec.decodePdf(row.config)
        PdfSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag, row.inferredSchema)
      case DataSourceKind.Image =>
        val cfg = DataSourceConfigCodec.decodeImage(row.config)
        ImageSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag, row.inferredSchema)
      case other =>
        throw new IllegalStateException(s"Unknown data source type in DB: '$other'")
    }
  }

  /** Flatten a typed ADT into a DB row. Each subtype emits its kind string and
   *  serialized config payload. DatasetSource stores `{}` to satisfy the
   *  `config` column NOT NULL constraint. */
  private def domainToRow(ds: DataSource): DataSourceRow = {
    val (kind, configJson) = ds match {
      case c: CsvSource    => (DataSourceKind.Csv,     DataSourceConfigCodec.encodeCsv(c.config))
      case r: RestSource   => (DataSourceKind.RestApi, DataSourceConfigCodec.encodeRest(r.config))
      case s: SqlSource    => (DataSourceKind.Sql,     DataSourceConfigCodec.encodeSql(s.config))
      // HEL-1074 design.md Decision 6: writes the canonical stored value "dataset" (not
      // "static") -- a new DatasetSource row would otherwise be rejected by the post-migration
      // `data_sources_source_type_check` constraint, which no longer accepts "static".
      case _: DatasetSource => (DataSourceKind.Dataset,  "{}")
      case t: TextSource   => (DataSourceKind.Text,    DataSourceConfigCodec.encodeText(t.config))
      case p: PdfSource    => (DataSourceKind.Pdf,     DataSourceConfigCodec.encodePdf(p.config))
      case i: ImageSource  => (DataSourceKind.Image,   DataSourceConfigCodec.encodeImage(i.config))
    }
    DataSourceRow(
      id             = ds.id.value,
      name           = ds.name,
      sourceType     = kind,
      config         = configJson,
      createdAt      = ds.createdAt,
      updatedAt      = ds.updatedAt,
      ownerId        = if (ds.ownerId.value.isEmpty) None else Some(UUID.fromString(ds.ownerId.value)),
      tag            = ds.tag,
      inferredSchema = ds.inferredSchema
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
    // HEL-1022: the UI column is labeled "Updated", not "Created" -- sort on the field the
    // header actually names so an edited (not just newly-created) source sorts to the top.
    val sliceAction = baseQuery.sortBy(_.updatedAt.desc).drop(page.offset).take(page.limit).result
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
      case _: DatasetSource => "{}"
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

  /** Read the raw stored `config` JSON for a DatasetSource (or any source).
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

  /** HEL-987 design.md Decision 1 (sole-root-only scope): pipelines for which `id` is the
   *  ONLY root -- deliberately NOT `WorkspaceTeardownRepository.sourceDependentPipelineConflict`,
   *  which matches ANY referencing pipeline and would silently implement the rejected
   *  `any-reference` scope. A pipeline with 2+ roots, one of which is `id`, is excluded by the
   *  `HAVING count(*) = 1` (over ALL of that pipeline's roots, not just the ones matching `id`),
   *  matching exactly the case V99's `hel913_prevent_zero_root_pipelines` trigger raises for:
   *  deleting `id` would cascade `pipeline_roots.data_source_id ON DELETE CASCADE` and leave the
   *  pipeline with zero roots. Run under `ctx.withUserContext`, consistent with `delete` above --
   *  RLS scopes the join to the caller's own pipelines (see design.md Risks). */
  def soleRootDependentPipelines(id: DataSourceId, user: AuthenticatedUser): Future[Vector[BlockingPipeline]] = {
    val action = sql"""SELECT p.id, p.name
                        FROM pipelines p
                        JOIN pipeline_roots r ON r.pipeline_id = p.id
                        WHERE p.id IN (
                          SELECT pipeline_id FROM pipeline_roots WHERE data_source_id = ${id.value}
                        )
                        GROUP BY p.id, p.name
                        HAVING count(*) = 1 AND bool_and(r.data_source_id = ${id.value})"""
      .as[(String, String)]
    ctx.withUserContext(user.id.value)(action).map(_.toVector.map { case (pid, name) => BlockingPipeline(pid, name) })
  }

  /** HEL-974 design.md D9 ("widen-precheck-privileged-count", owner ruling this run): a
   *  privileged, COUNT-ONLY companion to `soleRootDependentPipelines`, run on the BYPASSRLS pool.
   *
   *  Why this exists: after HEL-974's V100 makes `hel913_prevent_zero_root_pipelines` read with
   *  BYPASSRLS, the trigger can see (and refuse-on) a `pipeline_roots` row whose `pipelines` row
   *  is INVISIBLE to the caller's own RLS-scoped `soleRootDependentPipelines` (e.g. an editor
   *  bound their own source to another user's pipeline via `addRoot`'s `findByIdOwned` check,
   *  then lost the grant). Pre-HEL-974 that case silently created the orphan; post-HEL-974 the
   *  trigger correctly refuses it -- but `DataSourceService.delete` runs `deleteFileF` BETWEEN the
   *  RLS-scoped pre-check and the DB delete (HEL-987's own load-bearing ordering), so without this
   *  companion check the RLS-scoped pre-check sees nothing, the file is destroyed, and ONLY THEN
   *  does the trigger raise -- an irreversible file loss on a delete that should have been
   *  refused up front. This check must run BEFORE `deleteFileF`, immediately after the existing
   *  pre-check, so a refusal never destroys the file (see `DataSourceService.delete`).
   *
   *  The predicate is PINNED, not merely similar, to `soleRootDependentPipelines`'s own
   *  (`HAVING count(*) = 1 AND bool_and(r.data_source_id = <id>)`) -- differing in exactly two
   *  ways: it runs on the privileged pool, and it projects `count(*)` instead of `(id, name)`.
   *  Deliberately NOT `WorkspaceTeardownRepository`'s any-referencing predicate
   *  (`sourceDependentPipelineConflict`) -- that scope was already rejected for this feature
   *  (see `soleRootDependentPipelines`'s own doc) and would 409 every multi-root delete this
   *  trigger would never raise on, a new false positive this check must not introduce.
   *
   *  Returns a COUNT AND NOTHING ELSE -- no pipeline id, no name -- so the invisible-pipeline
   *  branch can never leak a cross-tenant identifier through a 409 body, an error message, or a
   *  log line (design.md D9). */
  def soleRootDependentPipelineCountPrivileged(id: DataSourceId): Future[Int] = {
    val action = sql"""SELECT count(*) FROM (
                          SELECT p.id
                          FROM pipelines p
                          JOIN pipeline_roots r ON r.pipeline_id = p.id
                          WHERE p.id IN (
                            SELECT pipeline_id FROM pipeline_roots WHERE data_source_id = ${id.value}
                          )
                          GROUP BY p.id
                          HAVING count(*) = 1 AND bool_and(r.data_source_id = ${id.value})
                        ) AS blocking""".as[Int].head
    ctx.withSystemContext(action)
  }

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

  /** HEL-904 (design.md line 92): writes the source's own `inferred_schema` column,
   *  replacing both `DataSourceService.upsertSourceDataType` and `SourceService`'s
   *  second upsert — there is no longer a companion `DataType` row to keep in sync,
   *  the schema lives directly on the source. In user context (RLS-gated write). */
  def upsertInferredSchema(id: DataSourceId, schema: Vector[SchemaField], updatedAt: Instant, user: AuthenticatedUser): Future[Option[DataSource]] = {
    val action = table
      .filter(_.id === id.value)
      .map(r => (r.inferredSchema, r.updatedAt))
      .update((schema, updatedAt))
      .andThen(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))
    ctx.withUserContext(user.id.value)(action)
  }

  /** HEL-1074 design.md Decision 7: insert a new `DatasetSource` ("dataset"-kind) row, its
   *  `dataset_rows`, and both schema columns (`dataset_schema` = the caller-declared columns;
   *  `inferred_schema` = the runtime-derived types, unchanged from today) in ONE transaction --
   *  replaces the old `insert` + `updateStaticPayload` two-step, which left a window where the
   *  source row existed with no row payload at all. `columns`/`rows` are stored verbatim
   *  (positional, not object-keyed -- Decision 3): each row is JSON-encoded as-is. */
  def insertDatasetSource(
      source:         DatasetSource,
      declaredColumns: Vector[SchemaField],
      rows:           Vector[Vector[JsValue]],
      inferredSchema: Vector[SchemaField],
      user:           AuthenticatedUser
  ): Future[DataSource] = {
    val rowsTable = TableQuery[DatasetRowTable]
    val rowInserts = rows.zipWithIndex.map { case (row, idx) =>
      DatasetRowRow(UUID.randomUUID().toString, source.id.value, idx.toLong, JsArray(row).compactPrint, source.createdAt, source.createdAt)
    }
    val action = for {
      _ <- table += domainToRow(source).copy(inferredSchema = inferredSchema)
      _ <- rowsTable ++= rowInserts
      _ <- table.filter(_.id === source.id.value).map(_.datasetSchema).update(Some(declaredColumns.toJson.compactPrint))
    } yield ()
    ctx.withUserContext(user.id.value)(action).map(_ => source.copy(inferredSchema = inferredSchema))
  }

  /** HEL-1074 design.md Decision 7: refresh replaces `dataset_rows` wholesale (delete-then-
   *  reinsert, matching the existing whole-payload-replace contract) and updates `dataset_schema`
   *  to the newly-declared columns, in the SAME transaction -- round-1's tasks.md draft omitted
   *  the `dataset_schema` update on refresh; the design's spec delta requires it.
   *
   *  Also updates `inferred_schema` in this SAME transaction (skeptic-final-1.md non-blocking
   *  note): `applyStaticRefresh` previously called this method and then `upsertSourceDataType`
   *  as two separate transactions, so a mid-way failure could leave `dataset_rows`/`dataset_schema`
   *  updated but `inferred_schema` stale -- a real, if narrow, atomicity gap against Decision 7's
   *  stated "runs as a single DB transaction" contract. Folding it in here closes that gap for
   *  the one caller (`applyStaticRefresh`) that has both values available at the same call site. */
  def replaceDatasetRows(
      id:              DataSourceId,
      declaredColumns: Vector[SchemaField],
      rows:            Vector[Vector[JsValue]],
      inferredSchema:  Vector[SchemaField],
      updatedAt:       Instant,
      user:            AuthenticatedUser
  ): Future[Option[DataSource]] = {
    val rowsTable = TableQuery[DatasetRowTable]
    val newRows = rows.zipWithIndex.map { case (row, idx) =>
      DatasetRowRow(UUID.randomUUID().toString, id.value, idx.toLong, JsArray(row).compactPrint, updatedAt, updatedAt)
    }
    val action = for {
      _    <- rowsTable.filter(_.dataSourceId === id.value).delete
      _    <- rowsTable ++= newRows
      _    <- table.filter(_.id === id.value)
                .map(r => (r.datasetSchema, r.inferredSchema, r.updatedAt))
                .update((Some(declaredColumns.toJson.compactPrint), inferredSchema, updatedAt))
      rowOpt <- table.filter(_.id === id.value).result.headOption
    } yield rowOpt.map(rowToDomain)
    ctx.withUserContext(user.id.value)(action)
  }

  /** HEL-1074 design.md Decision 9: read a "dataset"-kind source's `{columns, rows}` payload --
   *  the same shape `DataSourceRepository.parseStaticPayload` already produces from the legacy
   *  `config` blob -- from `dataset_schema` + `dataset_rows`, ordered by `seq`. Reads both in a
   *  SINGLE statement (a LEFT JOIN, not two sequential queries) so a concurrent `refreshStatic`
   *  (delete-then-reinsert) can never hand back a schema/rows pair straddling two different
   *  points in time. Privileged (system context): matches `readRawConfig`'s existing pool choice
   *  for all three call sites (engine, Spark, preview) -- ACL is enforced earlier, by
   *  `findByIdOwned`'s ownership check or the pipeline ACL at submission, not by this read.
   *  Returns `None` only when no `data_sources` row with this id exists at all -- a source with
   *  zero rows still returns `Some` with an empty `rows` array. */
  def readDatasetRows(id: DataSourceId): Future[Option[JsObject]] = {
    val rowsTable = TableQuery[DatasetRowTable]
    val query = table
      .filter(_.id === id.value)
      .joinLeft(rowsTable)
      .on((ds, dr) => ds.id === dr.dataSourceId)
      .sortBy { case (_, drOpt) => drOpt.map(_.seq) }
      .map { case (ds, drOpt) => (ds.datasetSchema, drOpt.map(_.data)) }
    ctx.withSystemContext(query.result).map { rows =>
      rows.headOption.map { case (schemaJsonOpt, _) =>
        val columns  = schemaJsonOpt.map(_.parseJson).getOrElse(JsArray.empty)
        val dataRows = rows.flatMap(_._2).map(_.parseJson)
        JsObject("columns" -> columns, "rows" -> JsArray(dataRows.toVector))
      }
    }
  }
}

object DataSourceRepository {

  /** HEL-987: one pipeline `soleRootDependentPipelines` found blocking a delete -- named fields
   *  instead of a positional `(String, String)` tuple so `id`/`name` can't be swapped by
   *  accident at a call site. */
  final case class BlockingPipeline(id: String, name: String)

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

  /** HEL-904: `data_sources.inferred_schema` JSONB column, the same `SchemaField`
   *  wire shape `OutputRepository` uses for `outputs.schema`. */
  implicit val schemaFieldsColumnType: BaseColumnType[Vector[SchemaField]] =
    MappedColumnType.base[Vector[SchemaField], String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[Vector[SchemaField]]
    )

  case class DataSourceRow(
      id: String,
      name: String,
      sourceType: String,
      config: String,
      createdAt: Instant,
      updatedAt: Instant,
      ownerId: Option[UUID],
      tag: Option[String] = None,
      inferredSchema: Vector[SchemaField] = Vector.empty
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
    def inferredSchema = column[Vector[SchemaField]]("inferred_schema")
    // HEL-1074 design.md Decision 9: deliberately NOT part of `DataSourceRow`/the `*` projection
    // (and so not exposed through `rowToDomain`/the `DataSource` ADT) -- `readDatasetRows` reads
    // this raw column directly, exactly like `readRawConfig` does for `config`. Nullable: NULL
    // for every non-`dataset` source kind.
    def datasetSchema = column[Option[String]]("dataset_schema")

    def * = (id, name, sourceType, config, createdAt, updatedAt, ownerId, tag, inferredSchema).mapTo[DataSourceRow]
  }

  /** HEL-1074: a single row of `dataset_rows` (a "dataset"-kind source's row payload, one JSONB
   *  array value per row, positionally aligned to the owning source's `dataset_schema` --
   *  design.md Decision 3). Deliberately its own table/row type, not folded into `DataSourceRow`
   *  -- a dataset source can have zero-to-many rows, unlike every other 1:1 source column. */
  case class DatasetRowRow(
      id:           String,
      dataSourceId: String,
      seq:          Long,
      data:         String,
      createdAt:    Instant,
      updatedAt:    Instant
  )

  class DatasetRowTable(slickTag: Tag) extends Table[DatasetRowRow](slickTag, "dataset_rows") {
    def id           = column[String]("id", O.PrimaryKey)
    def dataSourceId = column[String]("data_source_id")
    def seq          = column[Long]("seq")
    def data         = column[String]("data")(jsonbStringType)
    def createdAt    = column[Instant]("created_at")
    def updatedAt    = column[Instant]("updated_at")

    def * = (id, dataSourceId, seq, data, createdAt, updatedAt).mapTo[DatasetRowRow]
  }

  /** Parse a raw `{columns, rows}` JSON string into a `JsObject`, defaulting to empty on any
   *  non-object shape. HEL-1074: no `main` caller reads this off `data_sources.config` anymore
   *  (that store is retired for `dataset`-kind sources) -- the in-process engine, Spark
   *  submitter, and `previewStatic` all read `dataset_rows`/`dataset_schema` via
   *  `readDatasetRows` instead, which already returns a `JsObject` of this exact shape. Kept
   *  as a small parsing helper for tests (and for `PipelineRowJson.parseStaticRows`'s
   *  `raw: String`-taking overload, which pre-migration test fixtures still exercise). */
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
