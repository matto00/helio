package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{Page, PagedResult}
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SQLActionBuilder
import spray.json._
import spray.json.JsonParserSettings

import scala.concurrent.{ExecutionContext, Future}

/** HEL-904 (Outputs remodel) — replaces `DataTypeRowRepository`/
 *  `data_type_rows` (V29). Stores the latest materialized rows for a pipeline
 *  node, keyed by `(pipeline_id, node_step_id)` where `node_step_id = None`
 *  means the pipeline's raw source rows (mirrors [[com.helio.domain.model.NodeRef]]'s
 *  `stepId = None` convention).
 *
 *  Overwrite semantics are unchanged from `DataTypeRowRepository`: every
 *  successful non-dry run atomically replaces the entire snapshot for a given
 *  node via a transactional DELETE + bulk INSERT — no `run_id`, latest only,
 *  same retention as today.
 *
 *  Additive-only at this task (1.5): the `node_snapshots` table does not
 *  exist yet (lands in the V94 migration, task 2.4) — this repository is
 *  compiling scaffolding only until then. No caller wires it in yet. */
class NodeSnapshotRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  // Same rationale as DataTypeRowRepository.listRowsJsonParserSettings
  // (HEL-630) — Postgres jsonb numerics can exceed spray-json's 100-char
  // default cap on plain-decimal expansion.
  private val listRowsJsonParserSettings: JsonParserSettings =
    JsonParserSettings.default.withMaxNumberCharacters(400)

  /** Atomically replace the snapshot for `(pipelineId, nodeStepId)` with
   *  `rows`. Deletes all existing rows for that node first, then bulk-inserts
   *  the new ones inside a single transaction — the old snapshot survives any
   *  INSERT failure. An empty `rows` sequence clears the snapshot. */
  /** `explicitRootId` (HEL-913 design.md R12/5.8c) scopes a root-bound (`nodeStepId = None`)
   *  overwrite to ONE specific root, so writing root A's snapshot does not delete root B's --
   *  without it, both roots' rows match the bare `node_step_id IS NULL` predicate and
   *  "whichever root writes second wipes the other" (design.md R12's named bug). Defaulted to
   *  `None` (auto-resolve the pipeline's first/only root, exactly today's single-root behavior)
   *  so every pre-existing call site is unaffected; `PipelineRunService`'s multi-root-aware
   *  write path passes the target root explicitly. */
  def overwriteRows(pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String]): Future[Unit] = {
    val deleteAction = (nodeStepId, explicitRootId) match {
      case (Some(stepId), _) =>
        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id = $stepId"
      case (None, Some(rid)) =>
        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL AND root_id = $rid"
      case (None, None) =>
        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"
    }
    // HEL-913: a root-bound (`nodeStepId = None`) snapshot row needs `root_id` set (V98's
    // CHECK `(node_step_id IS NULL) <> (root_id IS NULL)`).
    val rootIdAction: DBIO[Option[String]] = (nodeStepId, explicitRootId) match {
      case (Some(_), _)      => DBIO.successful(None)
      case (None, Some(rid)) => DBIO.successful(Some(rid))
      case (None, None)      => sql"SELECT id FROM pipeline_roots WHERE pipeline_id = $pipelineId ORDER BY position LIMIT 1".as[String].headOption
    }
    val action = rootIdAction.flatMap { rootIdOpt =>
      val insertActions = rows.zipWithIndex.map { case (row, idx) =>
        val jsonStr = row.compactPrint
        (nodeStepId, rootIdOpt) match {
          case (Some(stepId), _) =>
            sqlu"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data) VALUES ($pipelineId, $stepId, $idx, $jsonStr::jsonb)"
          case (None, Some(rootId)) =>
            sqlu"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id) VALUES ($pipelineId, NULL, $idx, $jsonStr::jsonb, $rootId)"
          case (None, None) =>
            sqlu"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data) VALUES ($pipelineId, NULL, $idx, $jsonStr::jsonb)"
        }
      }
      DBIO.seq((deleteAction +: insertActions): _*)
    }
    ctx.withSystemContext(action.transactionally)
  }

  /** Return stored snapshot rows for `(pipelineId, nodeStepId)` ordered by
   *  `row_index` ascending. Empty Vector if no snapshot has been written yet.
   *
   *  `limit`/`excludeKeys` mirror `DataTypeRowRepository.listRows` exactly
   *  (HEL-372/HEL-217 rationale carried over unchanged). */
  def listRows(
      pipelineId: String,
      nodeStepId: Option[String],
      limit: Option[Int] = None,
      excludeKeys: Set[String] = Set.empty,
      // HEL-913 design.md R12: when `nodeStepId` is `None` (a root-bound read), names WHICH
      // root -- a bare `node_step_id IS NULL` would return every root's rows mixed together
      // under multi-root. Defaulted to `None` (unscoped, today's single-root-compatible
      // behavior) so every pre-existing call site is unaffected.
      explicitRootId: Option[String]
  ): Future[Vector[JsObject]] = {
    val dataExpr: SQLActionBuilder =
      excludeKeys.foldLeft(sql"data") { (acc, key) => acc.concat(sql" - $key::text") }

    val nodeFilter: SQLActionBuilder = (nodeStepId, explicitRootId) match {
      case (Some(stepId), _)  => sql" AND node_step_id = $stepId"
      case (None, Some(rid))  => sql" AND node_step_id IS NULL AND root_id = $rid"
      case (None, None)       => sql" AND node_step_id IS NULL"
    }

    val baseQuery: SQLActionBuilder =
      sql"SELECT (".concat(dataExpr).concat(sql")::text FROM node_snapshots WHERE pipeline_id = $pipelineId")
        .concat(nodeFilter)
        .concat(sql" ORDER BY row_index ASC")

    val fullQuery: SQLActionBuilder = limit match {
      case Some(n) => baseQuery.concat(sql" LIMIT $n")
      case None    => baseQuery
    }

    ctx
      .withSystemContext(fullQuery.as[String])
      .map(_.map(_.parseJson(listRowsJsonParserSettings).asJsObject).toVector)
  }

  /** HEL-906 cycle 7 (`GET /api/outputs/:id/rows`, P1.4's `get_output_rows` dependency):
   *  offset/limit paginated variant of `listRows` above, returning the total row count
   *  alongside the page so `OutputService.rows` can build a `PagedResult`. Mirrors
   *  `PanelRepository.findAllByDashboardId`'s `Page`-in/`PagedResult`-out convention. Runs two
   *  queries (a count, then the page) rather than a single `count(*) OVER()` window function --
   *  simplicity over one fewer round trip, matching every other paginated repository method in
   *  this codebase (none of them use a window function either). */
  def listRowsPaged(
      pipelineId: String,
      nodeStepId: Option[String],
      page: Page,
      excludeKeys: Set[String] = Set.empty,
      explicitRootId: Option[String]
  ): Future[PagedResult[JsObject]] = {
    val nodeFilter: SQLActionBuilder = (nodeStepId, explicitRootId) match {
      case (Some(stepId), _)  => sql" AND node_step_id = $stepId"
      case (None, Some(rid))  => sql" AND node_step_id IS NULL AND root_id = $rid"
      case (None, None)       => sql" AND node_step_id IS NULL"
    }

    val countQuery: SQLActionBuilder =
      sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = $pipelineId".concat(nodeFilter)

    val dataExpr: SQLActionBuilder =
      excludeKeys.foldLeft(sql"data") { (acc, key) => acc.concat(sql" - $key::text") }

    val dataQuery: SQLActionBuilder =
      sql"SELECT (".concat(dataExpr).concat(sql")::text FROM node_snapshots WHERE pipeline_id = $pipelineId")
        .concat(nodeFilter)
        .concat(sql" ORDER BY row_index ASC")
        .concat(sql" OFFSET ${page.offset} LIMIT ${page.limit}")

    for {
      total <- ctx.withSystemContext(countQuery.as[Int].head)
      rows  <- ctx.withSystemContext(dataQuery.as[String])
    } yield PagedResult(
      items  = rows.map(_.parseJson(listRowsJsonParserSettings).asJsObject).toVector,
      total  = total,
      offset = page.offset,
      limit  = page.limit
    )
  }
}
