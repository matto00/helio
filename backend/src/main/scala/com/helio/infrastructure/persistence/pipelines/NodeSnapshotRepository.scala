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

  /** D1 — `quickTerm` (if any) matches when ANY of `quickColumns` (every Structured-category
   *  column in the Output's schema, resolved by the caller) contains it; `columnTerms` are
   *  already-validated per-column terms, ANDed together and with the quick term. */
  final case class FilterSpec(quickTerm: Option[String], quickColumns: Vector[String], columnTerms: Map[String, String])

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

  /** Shared by every method below keyed on `(pipelineId, nodeStepId, explicitRootId)` -- extracted
   *  (HEL-1027) so `hasAnyRow`'s `WHERE` fragment can never drift from `listRowsPaged`'s own. */
  private def nodeFilterFragment(nodeStepId: Option[String], explicitRootId: Option[String]): SQLActionBuilder =
    (nodeStepId, explicitRootId) match {
      case (Some(stepId), _) => sql" AND node_step_id = $stepId"
      case (None, Some(rid)) => sql" AND node_step_id IS NULL AND root_id = $rid"
      case (None, None)      => sql" AND node_step_id IS NULL"
    }

  /** HEL-1027 design.md D6 — escapes `%`/`_`/`\` (Postgres `LIKE`/`ILIKE` metacharacters) in a
   *  user-supplied filter TERM before it becomes part of an `ILIKE '%...%'` pattern, so a term
   *  like `"50%"` is matched as the literal three characters, not as a wildcard — matching the
   *  client's existing `String.includes()` "contains" semantics (`tableFilterPredicate.ts`)
   *  exactly, rather than a related-but-different pattern-match semantics. The VALUE itself is
   *  still passed as a single bound parameter below; this only edits the value's own bytes before
   *  binding, and never touches SQL text. */
  private def escapeLikeTerm(term: String): String =
    term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

  /** The `ESCAPE` clause's escape-character argument, bound as an ordinary parameter (a
   *  one-character string) rather than embedded as literal SQL text -- Slick's `sql`
   *  interpolator does not re-process backslash escaping inside a literal text segment the way a
   *  plain Scala string literal does, so a literal `ESCAPE '\'` in the interpolated text is not
   *  reliable; binding it as a value sidesteps that entirely. */
  private val likeEscapeChar: String = "\\"

  /** HEL-1027 design.md D6 — ORs together an `ILIKE` comparison per column in `columns`, each a
   *  bound `(data ->> $col) ILIKE $pattern ESCAPE $likeEscapeChar` — the column NAME, the escaped
   *  pattern, AND the escape character are all bind parameters, never interpolated as raw SQL
   *  text. Empty `columns` (a quick term with no Structured-category column to match against at
   *  all) short-circuits to `FALSE`. */
  private def quickTermFragment(term: String, columns: Vector[String]): SQLActionBuilder = {
    val pattern = s"%${escapeLikeTerm(term)}%"
    if (columns.isEmpty) sql"FALSE"
    else {
      val parts: Vector[SQLActionBuilder] = columns.map(col => sql"(data ->> $col) ILIKE $pattern ESCAPE $likeEscapeChar")
      val joined = parts.tail.foldLeft(parts.head) { (acc, part) => acc.concat(sql" OR ").concat(part) }
      sql"(".concat(joined).concat(sql")")
    }
  }

  /** Builds the `WHERE`-clause tail (beyond the node filter) for `filter` (D1/D5/D6): the quick
   *  term's OR-fragment (if a non-blank quick term is present) ANDed with one `ILIKE` comparison
   *  per named column term. Returns `None` when `filter` is absent or carries no active term at
   *  all, so the caller can omit this fragment from the `WHERE` clause entirely rather than
   *  appending a vacuous `AND TRUE`. */
  private def filterWhereFragment(filter: Option[NodeSnapshotRepository.FilterSpec]): Option[SQLActionBuilder] =
    filter.flatMap { f =>
      val quickPart = f.quickTerm.filter(_.trim.nonEmpty).map(term => quickTermFragment(term, f.quickColumns))
      val columnParts: Vector[SQLActionBuilder] = f.columnTerms.collect {
        case (col, term) if term.trim.nonEmpty =>
          val pattern = s"%${escapeLikeTerm(term)}%"
          sql"(data ->> $col) ILIKE $pattern ESCAPE $likeEscapeChar"
      }.toVector
      val allParts = quickPart.toVector ++ columnParts
      if (allParts.isEmpty) None
      else Some(allParts.tail.foldLeft(sql" AND ".concat(allParts.head)) { (acc, part) => acc.concat(sql" AND ").concat(part) })
    }

  /** D2 — the cast expression a sort column resolves to, as a bound `data ->> $key` wrapped in
   *  the appropriate `safe_*` function (or left as plain text). */
  private def sortCastExpr(column: String, cast: NodeSnapshotRepository.SortCast): SQLActionBuilder = cast match {
    case NodeSnapshotRepository.SortCast.AsText      => sql"(data ->> $column)"
    case NodeSnapshotRepository.SortCast.AsNumeric   => sql"safe_numeric(data ->> $column)"
    case NodeSnapshotRepository.SortCast.AsTimestamp => sql"safe_timestamptz(data ->> $column)"
  }

  /** D4 — `row_index ASC` is ALWAYS the trailing tiebreaker, regardless of the requested `sort`,
   *  so two requests at an unchanged sort/filter never duplicate or drop rows across pages. The
   *  ASC/DESC keyword itself is never a bind parameter (Postgres doesn't accept one there) — safe
   *  to embed as literal SQL text ONLY because it is one of exactly two Scala-level enum literals
   *  chosen here, never the caller's raw string (D6; the route/service layer rejects anything
   *  other than `asc`/`desc` as `400` before a `SortSpec` can even be constructed). */
  private def orderByFragment(sort: Option[NodeSnapshotRepository.SortSpec]): SQLActionBuilder = sort match {
    case None => sql" ORDER BY row_index ASC"
    case Some(NodeSnapshotRepository.SortSpec(column, direction, cast)) =>
      val expr = sortCastExpr(column, cast)
      val dirSql = direction match {
        case NodeSnapshotRepository.SortDirection.Asc  => sql" ASC NULLS LAST"
        case NodeSnapshotRepository.SortDirection.Desc => sql" DESC NULLS LAST"
      }
      sql" ORDER BY ".concat(expr).concat(dirSql).concat(sql", row_index ASC")
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
}
