package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.BinaryRef
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import scala.concurrent.{ExecutionContext, Future}

/**
 * Stores row-correlated `binary-ref` field metadata for a pipeline node
 * (HEL-217, re-keyed by HEL-904 task 3.4).
 *
 * `binary_refs` is a derived secondary index over the same metadata already
 * present in the field's inline JSONB value in `node_snapshots.data` — never
 * an independent read path for row data (see design.md Decision 4). The
 * overwrite semantics mirror `NodeSnapshotRepository.overwriteRows` exactly:
 * every write atomically replaces the entire snapshot for a given node via a
 * transactional DELETE + bulk INSERT. There is no singular insert/delete(id)
 * — `overwriteForNode` is the only writer.
 *
 * HEL-904 (task 3.4): re-keyed from `data_type_id` to `(pipeline_id,
 * node_step_id)` (same additive-first pattern as
 * `AlertRuleRepository`/`AlertEventRepository`'s `target_output_id`
 * migration in task 3.1); the legacy `data_type_id` column was itself
 * dropped outright by V94 task 2.10 (`ALTER TABLE binary_refs DROP COLUMN
 * data_type_id`) alongside the rest of the DataType infrastructure — this
 * class no longer references it at all. `nodeStepId = None` means the
 * pipeline's trunk root, mirroring `NodeSnapshotRepository`'s own
 * convention.
 */
class BinaryRefRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  /**
   * Atomically replace the `binary_refs` snapshot for `(pipelineId,
   * nodeStepId)` with `refs`. Deletes all existing rows first, then
   * bulk-inserts the new ones — both operations run inside a single
   * transaction so the old snapshot survives any INSERT failure.
   *
   * Calling with an empty `refs` sequence clears the snapshot (DELETE only).
   */
  def overwriteForNode(pipelineId: String, nodeStepId: Option[String], refs: Vector[BinaryRef]): Future[Unit] = {
    val deleteAction = nodeStepId match {
      case Some(stepId) => sqlu"DELETE FROM binary_refs WHERE pipeline_id = $pipelineId AND node_step_id = $stepId"
      case None         => sqlu"DELETE FROM binary_refs WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"
    }
    val insertActions = refs.map { ref =>
      val createdAt = Timestamp.from(ref.createdAt)
      sqlu"""INSERT INTO binary_refs
               (id, pipeline_id, node_step_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at)
             VALUES
               (${ref.id}, ${ref.pipelineId}, ${ref.nodeStepId}, ${ref.rowIndex}, ${ref.fieldName}, ${ref.storageKey},
                ${ref.mimeType}, ${ref.filename}, ${ref.sizeBytes}, $createdAt)"""
    }
    val allActions = deleteAction +: insertActions
    ctx.withSystemContext(DBIO.seq(allActions: _*).transactionally)
  }

  /**
   * Return all `BinaryRef` records for `(pipelineId, nodeStepId)`. Returns
   * an empty Vector if no snapshot has been written yet.
   */
  def findByNode(pipelineId: String, nodeStepId: Option[String]): Future[Vector[BinaryRef]] =
    ctx.withSystemContext(selectQuery(pipelineId, nodeStepId)).map(_.map(rowToBinaryRef))

  /**
   * Return the `BinaryRef` records for `(pipelineId, nodeStepId)` scoped to
   * a single `rowIndex`.
   */
  def findByNodeAndRow(pipelineId: String, nodeStepId: Option[String], rowIndex: Int): Future[Vector[BinaryRef]] = {
    val query = nodeStepId match {
      case Some(stepId) =>
        sql"""SELECT id, pipeline_id, node_step_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at
              FROM binary_refs
              WHERE pipeline_id = $pipelineId AND node_step_id = $stepId AND row_index = $rowIndex"""
          .as[(String, String, Option[String], Int, String, String, String, String, Long, Timestamp)]
      case None =>
        sql"""SELECT id, pipeline_id, node_step_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at
              FROM binary_refs
              WHERE pipeline_id = $pipelineId AND node_step_id IS NULL AND row_index = $rowIndex"""
          .as[(String, String, Option[String], Int, String, String, String, String, Long, Timestamp)]
    }
    ctx.withSystemContext(query).map(_.map(rowToBinaryRef))
  }

  private def selectQuery(pipelineId: String, nodeStepId: Option[String]) = nodeStepId match {
    case Some(stepId) =>
      sql"""SELECT id, pipeline_id, node_step_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at
            FROM binary_refs
            WHERE pipeline_id = $pipelineId AND node_step_id = $stepId"""
        .as[(String, String, Option[String], Int, String, String, String, String, Long, Timestamp)]
    case None =>
      sql"""SELECT id, pipeline_id, node_step_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at
            FROM binary_refs
            WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""
        .as[(String, String, Option[String], Int, String, String, String, String, Long, Timestamp)]
  }

  private def rowToBinaryRef(
      row: (String, String, Option[String], Int, String, String, String, String, Long, Timestamp)
  ): BinaryRef = row match {
    case (id, pipelineId, nodeStepId, rowIndex, fieldName, storageKey, mimeType, filename, sizeBytes, createdAt) =>
      BinaryRef(
        id = id,
        pipelineId = pipelineId,
        nodeStepId = nodeStepId,
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
