package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{DataFieldType, Page, PagedResult}
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SQLActionBuilder
import spray.json._
import spray.json.JsonParserSettings

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1027 design.md D1/D2 — the `sort`/`filter` shapes `listRowsPaged` accepts, plus the
 *  `DataFieldType` -> cast-expression mapping (task 1.2) used to build a safe `ORDER BY`
 *  expression. Kept on the companion object (not nested in the class) so `OutputRowsQuery`
 *  (`OutputService`'s schema-resolution layer) can construct/reference these without an instance. */
object NodeSnapshotRepository {

  /** Which SQL cast a sort/filter column's declared `DataFieldType` resolves to (D2). */
  sealed trait SortCast
  object SortCast {
    case object AsText      extends SortCast
    case object AsNumeric   extends SortCast
    case object AsTimestamp extends SortCast
  }

  sealed trait SortDirection
  object SortDirection {
    case object Asc  extends SortDirection
    case object Desc extends SortDirection
  }

  final case class SortSpec(column: String, direction: SortDirection, cast: SortCast)

  /** HEL-1188 design.md D3/D5 — one resolved `ops[]` entry (already validated: column present +
   *  Structured, op type-eligible, `eq`/`in` cardinality-checked -- `OutputRowsQuery.resolveFilter`
   *  is the only producer). `cast` is the SAME `SortCast` a sort/quick/columns comparison on this
   *  column would use, so `eq`/`gte`/`lte`/`in` share the identical `safe_numeric`/`safe_timestamptz`
   *  wrapping this file already established for sort (D2 of HEL-1027, reused verbatim here). */
  sealed trait OpSpec { def column: String }
  object OpSpec {
    final case class Eq(column: String, cast: SortCast, value: String)            extends OpSpec
    final case class In(column: String, cast: SortCast, values: Vector[String])   extends OpSpec
    final case class Gte(column: String, cast: SortCast, value: String)           extends OpSpec
    final case class Lte(column: String, cast: SortCast, value: String)           extends OpSpec
  }

  /** D1 — `quickTerm` (if any) matches when ANY of `quickColumns` (every Structured-category
   *  column in the Output's schema, resolved by the caller) contains it; `columnTerms` are
   *  already-validated per-column terms, ANDed together and with the quick term. `ops` (HEL-1188
   *  design.md D3) adds range/equality/list-membership terms, ANDed together with everything else --
   *  defaulted to `Vector.empty` so every pre-existing `FilterSpec(...)` construction site (this
   *  file's own tests, `OutputRowsQuery`) keeps compiling unchanged. */
  final case class FilterSpec(
      quickTerm: Option[String],
      quickColumns: Vector[String],
      columnTerms: Map[String, String],
      ops: Vector[OpSpec] = Vector.empty
  )

  /** Task 1.2 — resolves a declared `DataFieldType` to its sortable-cast-expression kind. `None`
   *  for a Content-category type (`string-body`/`binary-ref`) — "not sortable" (D3), the caller's
   *  cue to reject the request as `400` before this repository is ever reached. Every
   *  `DataFieldType` case is enumerated explicitly so a future eighth case fails to compile here
   *  first, rather than silently falling through to a wrong cast. */
  def sortCastFor(fieldType: DataFieldType): Option[SortCast] = fieldType match {
    case DataFieldType.IntegerType | DataFieldType.FloatType       => Some(SortCast.AsNumeric)
    case DataFieldType.TimestampType                               => Some(SortCast.AsTimestamp)
    case DataFieldType.StringType | DataFieldType.BooleanType       => Some(SortCast.AsText)
    case DataFieldType.StringBodyType | DataFieldType.BinaryRefType => None
  }
}

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
  import NodeSnapshotFilterSql.{filterWhereFragment, orderByFragment}


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
  def overwriteRows(pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String]): Future[Unit] =
    ctx.withSystemContext(overwriteRowsAction(pipelineId, nodeStepId, rows, explicitRootId))

  /** `overwriteRows` plus `andThen` (HEL-1271: the per-Output history insert) in ONE transaction,
   *  so a failing `andThen` rolls back the replace. Run as two separate `withSystemContext` calls
   *  this would silently commit the replace first -- `withSystemContext` already wraps each call in
   *  its own transaction, so a bare `.transactionally` here would be a no-op, not the guarantee. */
  def overwriteRowsWith(
      pipelineId: String,
      nodeStepId: Option[String],
      rows: Seq[JsObject],
      explicitRootId: Option[String],
      andThen: DBIO[Unit]
  ): Future[Unit] =
    ctx.withSystemContext(overwriteRowsAction(pipelineId, nodeStepId, rows, explicitRootId).andThen(andThen))

  /** The replace as a composable `DBIO` (unchanged SQL); runs nothing by itself. */
  def overwriteRowsAction(pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String]): DBIO[Unit] = {
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
    action.transactionally
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
      // under multi-root. Required (no default): `None` is unscoped (today's
      // single-root-compatible behavior).
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

  /** Shared by every method below keyed on `(pipelineId, nodeStepId, explicitRootId)` -- extracted
   *  (HEL-1027) so `hasAnyRow`'s `WHERE` fragment can never drift from `listRowsPaged`'s own. */
  private def nodeFilterFragment(nodeStepId: Option[String], explicitRootId: Option[String]): SQLActionBuilder =
    (nodeStepId, explicitRootId) match {
      case (Some(stepId), _) => sql" AND node_step_id = $stepId"
      case (None, Some(rid)) => sql" AND node_step_id IS NULL AND root_id = $rid"
      case (None, None)      => sql" AND node_step_id IS NULL"
    }

  /** HEL-906 cycle 7 (`GET /api/outputs/:id/rows`, P1.4's `get_output_rows` dependency):
   *  offset/limit paginated variant of `listRows` above, returning the total row count
   *  alongside the page so `OutputService.rows` can build a `PagedResult`. Mirrors
   *  `PanelRepository.findAllByDashboardId`'s `Page`-in/`PagedResult`-out convention. Runs two
   *  queries (a count, then the page) rather than a single `count(*) OVER()` window function --
   *  simplicity over one fewer round trip, matching every other paginated repository method in
   *  this codebase (none of them use a window function either).
   *
   *  HEL-1027 design.md D1/D2/D4/D5/D6 — `sort`/`filter` are additive, defaulted `None` so
   *  `PublicDashboardRoutes.scala`'s own call site (which passes neither) keeps compiling and
   *  behaving identically. `total` (D5) reflects the FILTERED row count whenever `filter` is
   *  present -- `OutputService.rows` is responsible for not mistaking a legitimate zero-match
   *  filtered total for "never materialized" (see `hasAnyRow` below). */
  def listRowsPaged(
      pipelineId: String,
      nodeStepId: Option[String],
      page: Page,
      excludeKeys: Set[String] = Set.empty,
      explicitRootId: Option[String],
      sort: Option[NodeSnapshotRepository.SortSpec] = None,
      filter: Option[NodeSnapshotRepository.FilterSpec] = None
  ): Future[PagedResult[JsObject]] = {
    val nodeFilter = nodeFilterFragment(nodeStepId, explicitRootId)
    val filterFragment = filterWhereFragment(filter)

    val baseWhere: SQLActionBuilder =
      sql"WHERE pipeline_id = $pipelineId".concat(nodeFilter).concat(filterFragment.getOrElse(sql""))

    val countQuery: SQLActionBuilder =
      sql"SELECT count(*) FROM node_snapshots ".concat(baseWhere)

    val dataExpr: SQLActionBuilder =
      excludeKeys.foldLeft(sql"data") { (acc, key) => acc.concat(sql" - $key::text") }

    val dataQuery: SQLActionBuilder =
      sql"SELECT (".concat(dataExpr).concat(sql")::text FROM node_snapshots ")
        .concat(baseWhere)
        .concat(orderByFragment(sort))
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

  /** HEL-1326 design.md D3 -- one field's cell for EVERY row of the node matching `filter`, as
   *  single-key `{field -> cell}` objects (a row lacking the key yields `{}`, a JSON null yields
   *  `{field: null}`), always `row_index ASC` so an order-dependent reducer (`metric` with no
   *  aggregation reads the first row) has one defined answer. Backs the full-filtered-set metric
   *  headline; projecting one column keeps the unbounded read to a single cell per row. */
  def listFieldCells(
      pipelineId: String,
      nodeStepId: Option[String],
      explicitRootId: Option[String],
      field: String,
      filter: Option[NodeSnapshotRepository.FilterSpec]
  ): Future[Vector[JsObject]] = {
    val where: SQLActionBuilder =
      sql"WHERE pipeline_id = $pipelineId".concat(nodeFilterFragment(nodeStepId, explicitRootId)).concat(filterWhereFragment(filter).getOrElse(sql""))
    val query: SQLActionBuilder =
      sql"SELECT (data -> $field)::text FROM node_snapshots ".concat(where).concat(sql" ORDER BY row_index ASC")
    ctx.withSystemContext(query.as[Option[String]]).map(_.map {
      case None       => JsObject()
      case Some(text) => JsObject(field -> text.parseJson(listRowsJsonParserSettings))
    }.toVector)
  }

  /** HEL-1027 design.md D5 amendment (task 3.4) — a cheap, filter-INDEPENDENT existence check:
   *  does this node have ANY row at all? Used by `OutputService.rows` to derive `materialized`
   *  when a filter is active, since `listRowsPaged`'s `total` under a filter can legitimately be
   *  zero for an Output that has real data (D5's own worked example). Indexed via
   *  `idx_node_snapshots_pipeline_id` (V94) -- Postgres stops at the first match. */
  def hasAnyRow(pipelineId: String, nodeStepId: Option[String], explicitRootId: Option[String]): Future[Boolean] = {
    val query: SQLActionBuilder =
      sql"SELECT EXISTS(SELECT 1 FROM node_snapshots WHERE pipeline_id = $pipelineId"
        .concat(nodeFilterFragment(nodeStepId, explicitRootId))
        .concat(sql" LIMIT 1)")
    ctx.withSystemContext(query.as[Boolean].head)
  }

  /** HEL-1188 design.md D2/D5/D7 (task 1.2) — the cardinality-gate query behind `eq`/`in`
   *  eligibility: how many distinct non-null values `column` takes across this node's rows,
   *  capped at `capPlusOne` (only the OUTPUT of the count is bounded -- see D2's own correction:
   *  with no index on `data ->> $col`, Postgres must still scan every matching row to build the
   *  `HashAggregate`, so `capPlusOne` trims what comes BACK, never what gets SCANNED). Reuses
   *  `nodeFilterFragment` (never a second, independently-written WHERE fragment) — the column name
   *  is a bound parameter exactly like every other filter/sort column reference in this file (D6);
   *  this method's own callers (`OutputFilterCapability`) are what make that safe, since they only
   *  ever pass a column already drawn from the Output's own declared `schema`. */
  def distinctValueCountCapped(
      pipelineId: String,
      nodeStepId: Option[String],
      explicitRootId: Option[String],
      column: String,
      capPlusOne: Int
  ): Future[Int] = {
    val query: SQLActionBuilder =
      sql"SELECT count(*) FROM (SELECT 1 FROM node_snapshots WHERE pipeline_id = $pipelineId"
        .concat(nodeFilterFragment(nodeStepId, explicitRootId))
        .concat(sql" AND (data ->> $column) IS NOT NULL GROUP BY (data ->> $column) LIMIT $capPlusOne) t")
    ctx.withSystemContext(query.as[Int].head)
  }

  /** HEL-1188 design.md D4/D5 (task 1.2) — `GET /api/outputs/:id/distinct-values`'s own read: the
   *  top `cap` values by frequency, descending, for `column`. Same node-scoping fragment, same
   *  bound-parameter column reference, same "caller already validated this column" safety
   *  argument as `distinctValueCountCapped` above (D8). */
  def topDistinctValues(
      pipelineId: String,
      nodeStepId: Option[String],
      explicitRootId: Option[String],
      column: String,
      cap: Int
  ): Future[Vector[(String, Int)]] = {
    // `GROUP BY value`/`ORDER BY freq` reference the SELECT list's own output aliases (a Postgres
    // extension), NOT a second `(data ->> $column)` repeated with its own bind-parameter
    // placeholder -- two syntactically-separate `$n` placeholders are never recognized by
    // Postgres as "the same expression" for GROUP BY validity, even though they'd always receive
    // an equal bound value at runtime (confirmed directly: repeating the raw expression here
    // throws "column node_snapshots.data must appear in the GROUP BY clause"). Grouping/ordering
    // by alias sidesteps the mismatch entirely -- exactly the form design.md D4's own SQL sketch
    // used, rather than an expression this method's first draft (incorrectly) inlined a second time.
    val query: SQLActionBuilder =
      sql"SELECT (data ->> $column) AS value, count(*) AS freq FROM node_snapshots WHERE pipeline_id = $pipelineId"
        .concat(nodeFilterFragment(nodeStepId, explicitRootId))
        .concat(sql" AND (data ->> $column) IS NOT NULL GROUP BY value ORDER BY freq DESC LIMIT $cap")
    ctx.withSystemContext(query.as[(String, Int)]).map(_.toVector)
  }

  /** HEL-1206 design.md D3 -- exact row count of ONE node's snapshot (`count(*)`, O(rows in that
   *  node), served by `idx_node_snapshots_pipeline_id`). Shares `nodeFilterFragment` with
   *  `listRowsPaged`/`hasAnyRow` so the node predicate can never drift. `0` for a node with no
   *  snapshot (callers needing "never materialized" vs "empty" must combine it with run state). */
  def countRows(pipelineId: String, nodeStepId: Option[String], explicitRootId: Option[String]): Future[Long] = {
    val query: SQLActionBuilder =
      sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = $pipelineId"
        .concat(nodeFilterFragment(nodeStepId, explicitRootId))
    ctx.withSystemContext(query.as[Long].head)
  }
}
