package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SQLActionBuilder
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/**
 * Stores per-run JSONB row snapshots for a DataType.
 *
 * Overwrite semantics: every successful non-dry run atomically replaces the
 * entire snapshot for a given DataType via a transactional DELETE + bulk INSERT.
 */
class DataTypeRowRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  /**
   * Atomically replace the snapshot for `dataTypeId` with `rows`.
   * Deletes all existing rows first, then bulk-inserts the new ones — both
   * operations run inside a single transaction so the old snapshot survives
   * any INSERT failure.
   *
   * Calling with an empty `rows` sequence clears the snapshot (DELETE only).
   */
  def overwriteRows(dataTypeId: String, rows: Seq[JsObject]): Future[Unit] = {
    val deleteAction = sqlu"DELETE FROM data_type_rows WHERE data_type_id = $dataTypeId"
    val insertActions = rows.zipWithIndex.map { case (row, idx) =>
      val jsonStr = row.compactPrint
      sqlu"INSERT INTO data_type_rows (data_type_id, row_index, data) VALUES ($dataTypeId, $idx, $jsonStr::jsonb)"
    }
    val allActions = deleteAction +: insertActions
    ctx.withSystemContext(DBIO.seq(allActions: _*).transactionally)
  }

  /**
   * Return stored snapshot rows for `dataTypeId` ordered by row_index ascending.
   * Returns an empty Vector if no snapshot has been written yet.
   *
   * `limit`, when given, bounds the result at the SQL tier (`LIMIT`) rather
   * than fetching everything and slicing in the app — the whole point (HEL-372
   * design.md D1) is that Postgres never sends more rows than the caller
   * asked for.
   *
   * `excludeKeys`, when non-empty, strips those top-level JSONB keys from
   * every row's `data` value *inside the query* via Postgres's `jsonb - text`
   * operator, chained once per key — so a Content-category field (HEL-217's
   * `string-body`/`binary-ref`, which can store up to
   * `TEXT_MAX_FILE_SIZE_BYTES` of raw text/binary-ref JSON per cell) never
   * leaves Postgres at all, rather than being fetched and discarded
   * afterward. There is no other dynamic-arity query in this codebase, so
   * this is written and commented carefully:
   *   - Each key is a proper bind parameter via `SQLActionBuilder#concat`,
   *     never string-interpolated into the SQL text — no injection surface
   *     despite the variable number of keys.
   *   - Each bound key parameter carries an explicit `::text` cast. Postgres
   *     overloads the `jsonb -` operator for `text` / `integer` / `text[]`
   *     right-hand operands; without the cast, an untyped bind parameter can
   *     resolve to "operator is not unique".
   *   - Both `limit = None` and `excludeKeys = Set.empty` (the defaults)
   *     reproduce the exact prior unbounded/full-content query — every
   *     existing caller of the one-arg overload is unaffected.
   */
  def listRows(
      dataTypeId: String,
      limit: Option[Int] = None,
      excludeKeys: Set[String] = Set.empty
  ): Future[Vector[JsObject]] = {
    val dataExpr: SQLActionBuilder =
      excludeKeys.foldLeft(sql"data") { (acc, key) => acc.concat(sql" - $key::text") }

    val baseQuery: SQLActionBuilder =
      sql"SELECT (".concat(dataExpr).concat(sql")::text FROM data_type_rows WHERE data_type_id = $dataTypeId ORDER BY row_index ASC")

    val fullQuery: SQLActionBuilder = limit match {
      case Some(n) => baseQuery.concat(sql" LIMIT $n")
      case None    => baseQuery
    }

    ctx.withSystemContext(fullQuery.as[String]).map(_.map(_.parseJson.asJsObject).toVector)
  }
}
