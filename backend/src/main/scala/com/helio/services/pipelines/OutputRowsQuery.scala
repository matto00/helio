package com.helio.services.pipelines

import com.helio.domain.engine.SchemaField
import com.helio.domain.model.DataFieldType
import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository
import com.helio.services.ServiceError

/** HEL-1027 design.md D1/D2/D3 — the parsed `sort`/`filter` query-parameter shapes for
 *  `GET /api/outputs/:id/rows`, and the resolution logic that turns them into
 *  `NodeSnapshotRepository`-level specs against ONE Output's own declared `schema` (never
 *  inferred from sampled row data — MISTAKES.md). Kept out of `OutputService.scala` itself to
 *  keep that file within CONTRIBUTING.md's file-size budget; `OutputService.rows` is this
 *  object's only caller. */
object OutputRowsQuery {

  /** Already shape-validated by `OutputRoutes` (direction is one of exactly two enum values,
   *  never the caller's raw string — D6) before a `SortParam` can even be constructed. */
  final case class SortParam(column: String, direction: NodeSnapshotRepository.SortDirection)

  /** Mirrors the client's own `TableColumnFilters` wire shape (`outputConfigTypes.ts`) — the
   *  frontend serializes its in-memory filter state directly into this JSON, no new type (D1). */
  final case class FilterParam(quick: Option[String], columns: Map[String, String])

  /** D2/D3 — resolves a column name against `schema`'s Structured-category types only; `None`
   *  for a column absent from `schema` OR present with a Content-category type. */
  private def sortCastForColumn(schema: Vector[SchemaField], column: String): Option[NodeSnapshotRepository.SortCast] =
    schema.find(_.name == column).flatMap(f => DataFieldType.fromString(f.`type`)).flatMap(NodeSnapshotRepository.sortCastFor)

  /** D2/D3 (task 3.1) — a column is server-sortable only when it is present in `schema` with a
   *  Structured `DataFieldType`, resolving to a `SortSpec` the repository can build an `ORDER BY`
   *  expression from. `Left` names the offending column (D3's non-silent rejection contract). */
  def resolveSort(
      schema: Vector[SchemaField],
      sort: Option[SortParam]
  ): Either[ServiceError, Option[NodeSnapshotRepository.SortSpec]] =
    sort match {
      case None => Right(None)
      case Some(SortParam(column, direction)) =>
        sortCastForColumn(schema, column) match {
          case Some(cast) => Right(Some(NodeSnapshotRepository.SortSpec(column, direction, cast)))
          case None       => Left(ServiceError.BadRequest(s"column not sortable: '$column'"))
        }
    }

  /** D2/D3 (task 3.1) — every NAMED `filter.columns` entry must resolve to a Structured column
   *  (`Left` on the first offender, naming it); the `quick` term is exempt from this rejection
   *  (D3) — it is matched only against whichever Structured columns exist, silently excluding any
   *  Content-category column from its own OR rather than erroring, since the caller never names a
   *  specific column for it. Absent/empty `filter` (no active quick term and no column terms)
   *  resolves to `None`, matching `listRowsPaged`'s existing unfiltered behavior exactly. */
  def resolveFilter(
      schema: Vector[SchemaField],
      filter: Option[FilterParam]
  ): Either[ServiceError, Option[NodeSnapshotRepository.FilterSpec]] =
    filter match {
      case None => Right(None)
      case Some(FilterParam(quick, columns)) =>
        columns.keys.find(col => sortCastForColumn(schema, col).isEmpty) match {
          case Some(badColumn) => Left(ServiceError.BadRequest(s"column not filterable: '$badColumn'"))
          case None =>
            val quickColumns = schema.filter(f => DataFieldType.fromString(f.`type`).flatMap(NodeSnapshotRepository.sortCastFor).isDefined).map(_.name)
            val hasQuick   = quick.exists(_.trim.nonEmpty)
            val hasColumns = columns.exists { case (_, term) => term.trim.nonEmpty }
            if (!hasQuick && !hasColumns) Right(None)
            else
              Right(Some(NodeSnapshotRepository.FilterSpec(
                quickTerm    = quick.filter(_.trim.nonEmpty),
                quickColumns = quickColumns,
                columnTerms  = columns
              )))
        }
    }
}
