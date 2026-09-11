package com.helio.infrastructure.persistence.sources

import com.helio.infrastructure.persistence.DbContext
import com.helio.api.protocols.sources.DataSourceConfigCodec
import com.helio.domain.engine.{DatasetRowValidator, PipelineRowJson, SchemaField}
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
      declaredColumns: Vector[DatasetFieldDeclaration],
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

  /** HEL-1077 design.md D1: `SELECT id FROM data_sources WHERE id = ? FOR UPDATE`, RLS-scoped
   *  under the caller's user context. Serializes every write to a given source (append, PUT
   *  replace, and refresh's replace) against every other concurrent write to the SAME source --
   *  the single shared choke point that closes the refresh-races-append and
   *  concurrent-appends-jointly-exceed-the-limit races (design.md Risks). Returns `DBIO[Unit]`
   *  (not the row) -- every caller re-reads whatever columns it actually needs immediately after,
   *  inside the same transaction, so the lock and the read are never accidentally decoupled. */
  private def lockSource(id: DataSourceId): DBIO[Unit] =
    sql"SELECT id FROM data_sources WHERE id = ${id.value} FOR UPDATE".as[String].map(_ => ())

  /** HEL-1077 design.md D2/D3/D5, tasks.md 1.2: append `newRows` to a `dataset`-kind source's
   *  existing `dataset_rows`, inside one locked transaction. `newRows` are UNVALIDATED on entry --
   *  validated here (not by the caller) against the schema read fresh under the lock, so a
   *  concurrent schema-changing refresh can never be raced. Returns `None` when `id` does not
   *  exist (mirrors `replaceRows`'s existing not-found contract); `Left(msg)` for a validation or
   *  row-count failure (rolls back, no partial insert); `Right(...)` with the full persisted
   *  `DatasetRowRow`s for the NEWLY APPENDED rows only (not the pre-existing ones) plus the
   *  updated source, so the service can build the response DTO without a second read. */
  def appendRows(
      id:        DataSourceId,
      newRows:   Vector[Vector[JsValue]],
      maxRows:   Int,
      updatedAt: Instant,
      user:      AuthenticatedUser
  ): Future[Option[Either[String, (DataSource, Vector[DatasetRowRow])]]] = {
    val rowsTable = TableQuery[DatasetRowTable]
    val action = for {
      _              <- lockSource(id)
      schemaColOpt   <- table.filter(_.id === id.value).map(_.datasetSchema).result.headOption
      result <- schemaColOpt match {
        case None => DBIO.successful(None)
        case Some(schemaCol) =>
          val declaration = schemaCol
            .map(_.parseJson.convertTo[Vector[DatasetFieldDeclaration]])
            .getOrElse(Vector.empty)
          for {
            existingRows  <- rowsTable.filter(_.dataSourceId === id.value).sortBy(_.seq).result
            existingCount  = existingRows.size
            result <-
              if (existingCount + newRows.size > maxRows)
                DBIO.successful(Some(Left(s"Payload exceeds the maximum of $maxRows rows")))
              else DatasetRowValidator.validate(declaration, newRows) match {
                case Left(errors) => DBIO.successful(Some(Left(errors.mkString("; "))))
                case Right(validatedRows) =>
                  val maxExistingSeq = existingRows.map(_.seq).maxOption.getOrElse(-1L)
                  val inserted = validatedRows.zipWithIndex.map { case (row, idx) =>
                    DatasetRowRow(UUID.randomUUID().toString, id.value, maxExistingSeq + 1 + idx, JsArray(row).compactPrint, updatedAt, updatedAt)
                  }
                  val allCells = existingRows.map(r => r.data.parseJson.asInstanceOf[JsArray].elements) ++ inserted.map(r => r.data.parseJson.asInstanceOf[JsArray].elements)
                  val inferredSchema = declaration.zipWithIndex.map { case (field, i) =>
                    val cells = allCells.map(_.lift(i).getOrElse(JsNull))
                    SchemaField(field.name, PipelineRowJson.staticColumnRuntimeType(DataFieldType.asString(field.fieldType), cells))
                  }
                  for {
                    _      <- rowsTable ++= inserted
                    _      <- table.filter(_.id === id.value).map(r => (r.inferredSchema, r.updatedAt)).update((inferredSchema, updatedAt))
                    dsOpt  <- table.filter(_.id === id.value).result.headOption
                  } yield Some(Right((dsOpt.map(rowToDomain).get, inserted)))
              }
          } yield result
      }
    } yield result
    ctx.withUserContext(user.id.value)(action)
  }

  /** HEL-1077 design.md D1 (round-2 correction, skeptic-design-2.md): replaces `replaceDatasetRows`
   *  -- `declaration = Some(...)` for refresh (write this NEW schema, validate against it),
   *  `declaration = None` for `PUT .../rows` (read+keep the CURRENT schema, resolved fresh under
   *  the lock, never a pre-lock copy). `rows` are UNVALIDATED on entry -- `DatasetRowValidator
   *  .validate` runs inside this method's own transaction, against whichever declaration applies,
   *  so a validation failure rolls back the whole write (no partial persistence) regardless of
   *  which caller triggered it. Returns `None` for a nonexistent source id; `Left(msg)` for a
   *  validation/row-count failure; `Right` with the persisted `DatasetRowRow`s (not discarded, per
   *  design.md D1) and the updated source. */
  def replaceRows(
      id:          DataSourceId,
      declaration: Option[Vector[DatasetFieldDeclaration]],
      rows:        Vector[Vector[JsValue]],
      maxRows:     Int,
      updatedAt:   Instant,
      user:        AuthenticatedUser
  ): Future[Option[Either[String, (DataSource, Vector[DatasetRowRow])]]] = {
    val rowsTable = TableQuery[DatasetRowTable]
    val action = for {
      _              <- lockSource(id)
      schemaColOpt   <- table.filter(_.id === id.value).map(_.datasetSchema).result.headOption
      result <- schemaColOpt match {
        case None => DBIO.successful(None)
        case Some(schemaCol) =>
          val effectiveDeclaration = declaration.getOrElse(
            schemaCol.map(_.parseJson.convertTo[Vector[DatasetFieldDeclaration]]).getOrElse(Vector.empty)
          )
          if (rows.size > maxRows)
            DBIO.successful(Some(Left(s"Payload exceeds the maximum of $maxRows rows")))
          else DatasetRowValidator.validate(effectiveDeclaration, rows) match {
            case Left(errors) => DBIO.successful(Some(Left(errors.mkString("; "))))
            case Right(validatedRows) =>
              val newRows = validatedRows.zipWithIndex.map { case (row, idx) =>
                DatasetRowRow(UUID.randomUUID().toString, id.value, idx.toLong, JsArray(row).compactPrint, updatedAt, updatedAt)
              }
              val inferredSchema = effectiveDeclaration.zipWithIndex.map { case (field, i) =>
                val cells = validatedRows.map(_.lift(i).getOrElse(JsNull))
                SchemaField(field.name, PipelineRowJson.staticColumnRuntimeType(DataFieldType.asString(field.fieldType), cells))
              }
              for {
                _     <- rowsTable.filter(_.dataSourceId === id.value).delete
                _     <- rowsTable ++= newRows
                _     <- table.filter(_.id === id.value)
                           .map(r => (r.datasetSchema, r.inferredSchema, r.updatedAt))
                           .update((Some(effectiveDeclaration.toJson.compactPrint), inferredSchema, updatedAt))
                dsOpt <- table.filter(_.id === id.value).result.headOption
              } yield Some(Right((dsOpt.map(rowToDomain).get, newRows)))
          }
      }
    } yield result
    ctx.withUserContext(user.id.value)(action)
  }

  /** HEL-1078 design.md D1/D5: patch a single row's full data, guarded by an `updatedAt`
   *  precondition. Runs under the same `lockSource` `FOR UPDATE` as `appendRows`/`replaceRows` --
   *  the lock is what actually serializes concurrent writers to this source; the `updated_at`
   *  predicate on the conditional `UPDATE` is the stale-client check on top of it. The mutation
   *  statement's `WHERE` clause ALWAYS includes `data_source_id` alongside `id`/`updated_at`, so a
   *  `rowId` belonging to a different source than `id` can never match (design.md D1 round-2
   *  correction). Outcome order, matching design.md D5/D6 exactly: source missing -> `SourceNotFound`;
   *  row missing under this source -> `RowNotFound`; submitted row fails `DatasetRowValidator` ->
   *  `ValidationFailed` (checked BEFORE the conditional update runs, so a stale precondition is
   *  never disclosed for an invalid payload); conditional update affects 0 rows -> `StalePrecondition`
   *  carrying the row's actual current `updated_at` (read in step 2, safe under the same lock);
   *  otherwise `Right` with the updated source and the persisted row. */
  def patchRow(
      sourceId:          DataSourceId,
      rowId:             String,
      data:              Vector[JsValue],
      expectedUpdatedAt: Instant,
      newUpdatedAt:      Instant,
      user:              AuthenticatedUser
  ): Future[Either[RowMutationFailure, (DataSource, DatasetRowRow)]] = {
    val rowsTable = TableQuery[DatasetRowTable]
    val action = for {
      _            <- lockSource(sourceId)
      schemaColOpt <- table.filter(_.id === sourceId.value).map(_.datasetSchema).result.headOption
      result <- schemaColOpt match {
        case None => DBIO.successful(Left(RowMutationFailure.SourceNotFound))
        case Some(schemaCol) =>
          val declaration = schemaCol
            .map(_.parseJson.convertTo[Vector[DatasetFieldDeclaration]])
            .getOrElse(Vector.empty)
          rowsTable.filter(r => r.id === rowId && r.dataSourceId === sourceId.value).result.headOption.flatMap {
            case None => DBIO.successful(Left(RowMutationFailure.RowNotFound))
            case Some(currentRow) =>
              DatasetRowValidator.validate(declaration, Vector(data)) match {
                case Left(errors) => DBIO.successful(Left(RowMutationFailure.ValidationFailed(errors.mkString("; "))))
                case Right(validatedRows) =>
                  val validated   = validatedRows.head
                  val newDataJson = JsArray(validated).compactPrint
                  for {
                    affected <- rowsTable
                      .filter(r => r.id === rowId && r.dataSourceId === sourceId.value && r.updatedAt === expectedUpdatedAt)
                      .map(r => (r.data, r.updatedAt))
                      .update((newDataJson, newUpdatedAt))
                    result <-
                      if (affected == 0) DBIO.successful(Left(RowMutationFailure.StalePrecondition(currentRow.updatedAt)))
                      else recomputeAfterMutation(sourceId, declaration, newUpdatedAt).map { ds =>
                        Right((ds, currentRow.copy(data = newDataJson, updatedAt = newUpdatedAt)))
                      }
                  } yield result
              }
          }
      }
    } yield result
    ctx.withUserContext(user.id.value)(action)
  }

  /** HEL-1078 design.md D1/D5: delete a single row, guarded by an `updatedAt` precondition --
   *  same lock/scoping/outcome-ordering discipline as `patchRow`, minus the validation step. A
   *  conditional `DELETE` affecting 0 rows cannot by itself distinguish "never existed" from
   *  "existed but was stale" (design.md D5), which is why step 2's existence read happens first,
   *  under the same lock, before the conditional delete runs. */
  def deleteRow(
      sourceId:          DataSourceId,
      rowId:             String,
      expectedUpdatedAt: Instant,
      newUpdatedAt:      Instant,
      user:              AuthenticatedUser
  ): Future[Either[RowMutationFailure, DataSource]] = {
    val rowsTable = TableQuery[DatasetRowTable]
    val action = for {
      _            <- lockSource(sourceId)
      schemaColOpt <- table.filter(_.id === sourceId.value).map(_.datasetSchema).result.headOption
      result <- schemaColOpt match {
        case None => DBIO.successful(Left(RowMutationFailure.SourceNotFound))
        case Some(schemaCol) =>
          val declaration = schemaCol
            .map(_.parseJson.convertTo[Vector[DatasetFieldDeclaration]])
            .getOrElse(Vector.empty)
          rowsTable.filter(r => r.id === rowId && r.dataSourceId === sourceId.value).result.headOption.flatMap {
            case None => DBIO.successful(Left(RowMutationFailure.RowNotFound))
            case Some(currentRow) =>
              for {
                affected <- rowsTable
                  .filter(r => r.id === rowId && r.dataSourceId === sourceId.value && r.updatedAt === expectedUpdatedAt)
                  .delete
                result <-
                  if (affected == 0) DBIO.successful(Left(RowMutationFailure.StalePrecondition(currentRow.updatedAt)))
                  else recomputeAfterMutation(sourceId, declaration, newUpdatedAt).map(ds => Right(ds))
              } yield result
          }
      }
    } yield result
    ctx.withUserContext(user.id.value)(action)
  }

  /** Shared post-mutation step for `patchRow`/`deleteRow` (design.md D7): re-read the full,
   *  post-write `dataset_rows` set for `sourceId` inside the same transaction, recompute
   *  `inferred_schema` with the exact same column-wise computation `appendRows`/`replaceRows`
   *  already inline, and persist it alongside the source's `updated_at` bump. */
  private def recomputeAfterMutation(
      sourceId:     DataSourceId,
      declaration:  Vector[DatasetFieldDeclaration],
      newUpdatedAt: Instant
  ): DBIO[DataSource] = {
    val rowsTable = TableQuery[DatasetRowTable]
    for {
      remainingRows <- rowsTable.filter(_.dataSourceId === sourceId.value).result
      allCells       = remainingRows.map(r => r.data.parseJson.asInstanceOf[JsArray].elements)
      inferredSchema = declaration.zipWithIndex.map { case (field, i) =>
        val cells = allCells.map(_.lift(i).getOrElse(JsNull))
        SchemaField(field.name, PipelineRowJson.staticColumnRuntimeType(DataFieldType.asString(field.fieldType), cells))
      }
      _     <- table.filter(_.id === sourceId.value).map(r => (r.inferredSchema, r.updatedAt)).update((inferredSchema, newUpdatedAt))
      dsOpt <- table.filter(_.id === sourceId.value).result.headOption
    } yield dsOpt.map(rowToDomain).get
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

  /** HEL-1078 design.md D5/D6: the four (PATCH: five, including `ValidationFailed`) distinguishable
   *  outcomes of `patchRow`/`deleteRow` other than success -- a sealed trait rather than a nested
   *  `Either`/`Option` so the service layer's `match` can never accidentally conflate two of them
   *  (task 1.3). `DELETE` never produces `ValidationFailed`; sharing one trait rather than two
   *  near-identical ones keeps the repository's mutation methods symmetric. */
  sealed trait RowMutationFailure
  object RowMutationFailure {
    case object SourceNotFound extends RowMutationFailure
    case object RowNotFound extends RowMutationFailure
    final case class ValidationFailed(message: String) extends RowMutationFailure
    final case class StalePrecondition(currentUpdatedAt: Instant) extends RowMutationFailure
  }

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
