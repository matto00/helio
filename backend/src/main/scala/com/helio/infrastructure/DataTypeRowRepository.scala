package com.helio.infrastructure

import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/**
 * Stores per-run JSONB row snapshots for a DataType.
 *
 * Overwrite semantics: every successful non-dry run atomically replaces the
 * entire snapshot for a given DataType via a transactional DELETE + bulk INSERT.
 */
class DataTypeRowRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext) {

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
    db.run(DBIO.seq(allActions: _*).transactionally)
  }

  /**
   * Return all stored snapshot rows for `dataTypeId` ordered by row_index ascending.
   * Returns an empty Vector if no snapshot has been written yet.
   */
  def listRows(dataTypeId: String): Future[Vector[JsObject]] =
    db.run(
      sql"SELECT data::text FROM data_type_rows WHERE data_type_id = $dataTypeId ORDER BY row_index ASC"
        .as[String]
    ).map(_.map(_.parseJson.asJsObject).toVector)
}
