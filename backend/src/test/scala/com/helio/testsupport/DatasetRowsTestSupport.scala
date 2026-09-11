package com.helio.testsupport

import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/** HEL-1074: shared seed helper for tests that insert `data_sources` rows directly via raw SQL
 *  with `source_type = 'dataset'` and need matching `dataset_rows` + `dataset_schema` content --
 *  the migration moved a "dataset"-kind source's row payload off `data_sources.config` (unused,
 *  cleared to `{}`) into these two places. Centralizes the positional-array insert shape
 *  (design.md Decision 3) so individual test files don't hand-roll it. */
object DatasetRowsTestSupport {

  /** Build the `DBIO` action that seeds `dataset_schema` + `dataset_rows` for `dataSourceId`
   *  from a `{columns, rows}` JSON payload -- the SAME shape every "static"/"dataset" source
   *  test fixture already builds for the (now-unused) `data_sources.config` blob. `now` is used
   *  for every row's created/updated timestamps, matching the migration's own backfill (Decision
   *  2 step 1). Must be run AFTER the corresponding `data_sources` row has been inserted (FK). */
  def seedActions(dataSourceId: String, payload: JsObject, now: Instant = Instant.now()): DBIO[Unit] = {
    val columns = payload.fields.getOrElse("columns", JsArray.empty)
    val rows    = payload.fields.getOrElse("rows", JsArray.empty) match {
      case JsArray(elements) => elements
      case _                 => Vector.empty
    }
    val ts = Timestamp.from(now)
    val columnsJson = columns.compactPrint

    val rowInserts = rows.zipWithIndex.map { case (rowJson, idx) =>
      val seq     = idx.toLong
      val dataStr = rowJson.compactPrint
      sqlu"""INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at)
             VALUES (${UUID.randomUUID().toString}, $dataSourceId, $seq, $dataStr::jsonb, $ts, $ts)"""
    }

    DBIO.seq(
      sqlu"""UPDATE data_sources SET dataset_schema = $columnsJson::jsonb WHERE id = $dataSourceId""",
      DBIO.seq(rowInserts: _*)
    )
  }

  /** Convenience overload: parses a raw `{columns, rows}` JSON string (the shape most existing
   *  test fixtures already build as a `String` literal for the old `config` column) before
   *  delegating to [[seedActions(String,JsObject,Instant)*]]. */
  def seedActionsFromRaw(dataSourceId: String, rawPayload: String, now: Instant = Instant.now()): DBIO[Unit] =
    seedActions(dataSourceId, rawPayload.parseJson.asJsObject, now)
}
