package com.helio.infrastructure

import com.helio.domain.BinaryRef
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import scala.concurrent.{ExecutionContext, Future}

/**
 * Stores row-correlated `binary-ref` field metadata for a DataType (HEL-217).
 *
 * `binary_refs` is a derived secondary index over the same metadata already
 * present in the field's inline JSONB value in `data_type_rows.data` — never
 * an independent read path for row data (see design.md Decision 4). The
 * overwrite semantics mirror `DataTypeRowRepository.overwriteRows` exactly:
 * every write atomically replaces the entire snapshot for a given DataType
 * via a transactional DELETE + bulk INSERT. There is no singular
 * insert/delete(id) — `overwriteForDataType` is the only writer.
 */
class BinaryRefRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  /**
   * Atomically replace the `binary_refs` snapshot for `dataTypeId` with
   * `refs`. Deletes all existing rows first, then bulk-inserts the new
   * ones — both operations run inside a single transaction so the old
   * snapshot survives any INSERT failure.
   *
   * Calling with an empty `refs` sequence clears the snapshot (DELETE only).
   */
  def overwriteForDataType(dataTypeId: String, refs: Vector[BinaryRef]): Future[Unit] = {
    val deleteAction = sqlu"DELETE FROM binary_refs WHERE data_type_id = $dataTypeId"
    val insertActions = refs.map { ref =>
      val createdAt = Timestamp.from(ref.createdAt)
      sqlu"""INSERT INTO binary_refs
               (id, data_type_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at)
             VALUES
               (${ref.id}, ${ref.dataTypeId}, ${ref.rowIndex}, ${ref.fieldName}, ${ref.storageKey},
                ${ref.mimeType}, ${ref.filename}, ${ref.sizeBytes}, $createdAt)"""
    }
    val allActions = deleteAction +: insertActions
    ctx.withSystemContext(DBIO.seq(allActions: _*).transactionally)
  }

  /**
   * Return all `BinaryRef` records for `dataTypeId`. Returns an empty
   * Vector if no snapshot has been written yet.
   */
  def findByDataTypeId(dataTypeId: String): Future[Vector[BinaryRef]] =
    ctx.withSystemContext(selectQuery(dataTypeId)).map(_.map(rowToBinaryRef))

  /**
   * Return the `BinaryRef` records for `dataTypeId` scoped to a single
   * `rowIndex`.
   */
  def findByDataTypeIdAndRow(dataTypeId: String, rowIndex: Int): Future[Vector[BinaryRef]] =
    ctx
      .withSystemContext(
        sql"""SELECT id, data_type_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at
              FROM binary_refs
              WHERE data_type_id = $dataTypeId AND row_index = $rowIndex"""
          .as[(String, String, Int, String, String, String, String, Long, Timestamp)]
      )
      .map(_.map(rowToBinaryRef))

  private def selectQuery(dataTypeId: String) =
    sql"""SELECT id, data_type_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at
          FROM binary_refs
          WHERE data_type_id = $dataTypeId"""
      .as[(String, String, Int, String, String, String, String, Long, Timestamp)]

  private def rowToBinaryRef(
      row: (String, String, Int, String, String, String, String, Long, Timestamp)
  ): BinaryRef = row match {
    case (id, dataTypeId, rowIndex, fieldName, storageKey, mimeType, filename, sizeBytes, createdAt) =>
      BinaryRef(
        id = id,
        dataTypeId = dataTypeId,
        rowIndex = rowIndex,
        fieldName = fieldName,
        storageKey = storageKey,
        mimeType = mimeType,
        filename = filename,
        sizeBytes = sizeBytes,
        createdAt = createdAt.toInstant
      )
  }
}
