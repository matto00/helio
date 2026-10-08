package com.helio.infrastructure.persistence.pipelines

import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SQLActionBuilder

/** HEL-1027 / HEL-1188 -- pure SQL-fragment construction for `NodeSnapshotRepository`'s filtered and
 *  sorted reads: `ILIKE` term escaping, `ops[]` casts and comparisons, the `WHERE` tail and `ORDER BY`.
 *  Touches no `DbContext`; every fragment binds its values as parameters. The node-scoping predicate
 *  every read shares (`nodeFilterFragment`) stays on the repository. */
private[pipelines] object NodeSnapshotFilterSql {

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

  /** HEL-1188 design.md D3 (skeptic-design-1.md CR2's revision) — the VALUE side of an `ops[]`
   *  comparison, cast identically to the column side (`sortCastExpr` below) so
   *  `safe_numeric(data ->> $col) = safe_numeric($value)` never degrades to a raw
   *  `data ->> $col = $value::numeric` (which would reintroduce HEL-1027 D2's one-bad-row-500 bug
   *  on the value side). `AsText` binds the value plainly -- no cast applies to a text/boolean
   *  comparison, matching `eq`'s existing quick/columns text-compare treatment. */
  private def opValueCastExpr(value: String, cast: NodeSnapshotRepository.SortCast): SQLActionBuilder = cast match {
    case NodeSnapshotRepository.SortCast.AsText      => sql"$value"
    case NodeSnapshotRepository.SortCast.AsNumeric   => sql"safe_numeric($value)"
    case NodeSnapshotRepository.SortCast.AsTimestamp => sql"safe_timestamptz($value)"
  }

  /** HEL-1188 design.md D3 — one bound comparison fragment per `OpSpec`. `In`'s value list casts
   *  EACH element individually (never a single raw `IN (...)` compared as text) -- a malformed
   *  element casts to `NULL` and simply matches no row, never failing the other elements or the
   *  request (task 7.5). `values` is guaranteed non-empty by `OutputRoutes.parseFilterParam`
   *  (an empty `in` list is rejected as 400 before this is ever reached), so `.tail`/`.head` below
   *  are safe. */
  private def opFragment(op: NodeSnapshotRepository.OpSpec): SQLActionBuilder = op match {
    case NodeSnapshotRepository.OpSpec.Eq(column, cast, value) =>
      sortCastExpr(column, cast).concat(sql" = ").concat(opValueCastExpr(value, cast))
    case NodeSnapshotRepository.OpSpec.Gte(column, cast, value) =>
      sortCastExpr(column, cast).concat(sql" >= ").concat(opValueCastExpr(value, cast))
    case NodeSnapshotRepository.OpSpec.Lte(column, cast, value) =>
      sortCastExpr(column, cast).concat(sql" <= ").concat(opValueCastExpr(value, cast))
    case NodeSnapshotRepository.OpSpec.In(column, cast, values) =>
      val valueExprs = values.map(v => opValueCastExpr(v, cast))
      val joined     = valueExprs.tail.foldLeft(valueExprs.head) { (acc, v) => acc.concat(sql", ").concat(v) }
      sortCastExpr(column, cast).concat(sql" IN (").concat(joined).concat(sql")")
  }

  /** Builds the `WHERE`-clause tail (beyond the node filter) for `filter` (D1/D5/D6, extended by
   *  HEL-1188 D3): the quick term's OR-fragment (if a non-blank quick term is present) ANDed with
   *  one `ILIKE` comparison per named column term, ANDed with one comparison fragment per `ops[]`
   *  entry. Returns `None` when `filter` is absent or carries no active term at all, so the caller
   *  can omit this fragment from the `WHERE` clause entirely rather than appending a vacuous
   *  `AND TRUE`. */
  private[pipelines] def filterWhereFragment(filter: Option[NodeSnapshotRepository.FilterSpec]): Option[SQLActionBuilder] =
    filter.flatMap { f =>
      val quickPart = f.quickTerm.filter(_.trim.nonEmpty).map(term => quickTermFragment(term, f.quickColumns))
      val columnParts: Vector[SQLActionBuilder] = f.columnTerms.collect {
        case (col, term) if term.trim.nonEmpty =>
          val pattern = s"%${escapeLikeTerm(term)}%"
          sql"(data ->> $col) ILIKE $pattern ESCAPE $likeEscapeChar"
      }.toVector
      val opParts: Vector[SQLActionBuilder] = f.ops.map(opFragment)
      val allParts = quickPart.toVector ++ columnParts ++ opParts
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
  private[pipelines] def orderByFragment(sort: Option[NodeSnapshotRepository.SortSpec]): SQLActionBuilder = sort match {
    case None => sql" ORDER BY row_index ASC"
    case Some(NodeSnapshotRepository.SortSpec(column, direction, cast)) =>
      val expr = sortCastExpr(column, cast)
      val dirSql = direction match {
        case NodeSnapshotRepository.SortDirection.Asc  => sql" ASC NULLS LAST"
        case NodeSnapshotRepository.SortDirection.Desc => sql" DESC NULLS LAST"
      }
      sql" ORDER BY ".concat(expr).concat(dirSql).concat(sql", row_index ASC")
  }
}
