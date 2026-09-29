package com.helio.services.pipelines

import com.helio.domain.engine.SchemaField
import com.helio.domain.model.{DataFieldType, Output}
import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1027 design.md D1/D2/D3 (extended by HEL-1188 D3) — the parsed `sort`/`filter`
 *  query-parameter shapes for `GET /api/outputs/:id/rows`, and the resolution logic that turns
 *  them into `NodeSnapshotRepository`-level specs against ONE Output's own declared `schema`
 *  (never inferred from sampled row data — MISTAKES.md). Kept out of `OutputService.scala` itself
 *  to keep that file within CONTRIBUTING.md's file-size budget; `OutputService.rows` is this
 *  object's only caller. */
object OutputRowsQuery {

  /** Already shape-validated by `OutputRoutes` (direction is one of exactly two enum values,
   *  never the caller's raw string — D6) before a `SortParam` can even be constructed. */
  final case class SortParam(column: String, direction: NodeSnapshotRepository.SortDirection)

  /** HEL-1188 design.md D3 — one `filter.ops[]` entry, already SHAPE-validated by
   *  `OutputRoutes.parseFilterParam` (required `value`/`values` present, `in`'s 1-100 bound,
   *  no duplicate column+op pair) — everything that does NOT require the Output's own `schema`.
   *  `resolveFilter` below does the schema/cardinality-dependent half: column present + Structured,
   *  op type-eligible, `eq`/`in` cardinality. A sealed ADT per op (rather than one case class with
   *  optional `value`/`values` fields) so a malformed construction is a compile error, not a
   *  runtime `.get` on an absent `Option`. */
  sealed trait OpsTerm { def column: String; def opName: String }
  object OpsTerm {
    final case class Eq(column: String, value: String)              extends OpsTerm { val opName = "eq"  }
    final case class In(column: String, values: Vector[String])     extends OpsTerm { val opName = "in"  }
    final case class Gte(column: String, value: String)             extends OpsTerm { val opName = "gte" }
    final case class Lte(column: String, value: String)             extends OpsTerm { val opName = "lte" }
  }

  /** Mirrors the client's own `TableColumnFilters` wire shape (`outputConfigTypes.ts`) — the
   *  frontend serializes its in-memory filter state directly into this JSON, no new type (D1).
   *  `ops` (HEL-1188 D3) is additive and defaulted to `Vector.empty` so every pre-existing
   *  `FilterParam(quick, columns)` construction site keeps compiling unchanged. */
  final case class FilterParam(quick: Option[String], columns: Map[String, String], ops: Vector[OpsTerm] = Vector.empty)

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

  /** HEL-1188 design.md D3 — resolves ONE `ops[]` entry against `schema`/the Output's own data, in
   *  the exact order D3 specifies: (1) column present + Structured, (2) op type-eligible for that
   *  column's type (`gte`/`lte` reject a `string`/`boolean` column, since `AsText` isn't a range
   *  cast), (3) for `eq`/`in` only, `OutputFilterCapability`'s shared cardinality check. */
  private def resolveOneOp(
      schema: Vector[SchemaField],
      term: OpsTerm,
      output: Output,
      nodeSnapshotRepo: NodeSnapshotRepository
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, NodeSnapshotRepository.OpSpec]] =
    sortCastForColumn(schema, term.column) match {
      case None =>
        Future.successful(Left(ServiceError.BadRequest(s"column not filterable: '${term.column}'")))
      case Some(cast) =>
        term match {
          case OpsTerm.Gte(column, value) =>
            if (cast == NodeSnapshotRepository.SortCast.AsText)
              Future.successful(Left(ServiceError.BadRequest(s"op 'gte' not valid for column '$column'")))
            else Future.successful(Right(NodeSnapshotRepository.OpSpec.Gte(column, cast, value)))
          case OpsTerm.Lte(column, value) =>
            if (cast == NodeSnapshotRepository.SortCast.AsText)
              Future.successful(Left(ServiceError.BadRequest(s"op 'lte' not valid for column '$column'")))
            else Future.successful(Right(NodeSnapshotRepository.OpSpec.Lte(column, cast, value)))
          case OpsTerm.Eq(column, value) =>
            OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, column).map {
              case Left(_)   => Left(ServiceError.BadRequest(s"op 'eq' not valid for column '$column'"))
              case Right(()) => Right(NodeSnapshotRepository.OpSpec.Eq(column, cast, value))
            }
          case OpsTerm.In(column, values) =>
            OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, column).map {
              case Left(_)   => Left(ServiceError.BadRequest(s"op 'in' not valid for column '$column'"))
              case Right(()) => Right(NodeSnapshotRepository.OpSpec.In(column, cast, values))
            }
        }
    }

  /** Sequential (not `Future.traverse`) — a request naming several `eq`/`in` columns pays one
   *  cardinality-check query per named column, one at a time, rather than fanning them out
   *  concurrently against the DB (design.md D6: this is already the one on-demand cost `/rows`
   *  accepts per request; typically 0-3 columns for a real panel's controls). */
  private def resolveOps(
      schema: Vector[SchemaField],
      ops: Vector[OpsTerm],
      output: Output,
      nodeSnapshotRepo: NodeSnapshotRepository
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Vector[NodeSnapshotRepository.OpSpec]]] =
    ops.foldLeft(Future.successful(Right(Vector.empty[NodeSnapshotRepository.OpSpec]): Either[ServiceError, Vector[NodeSnapshotRepository.OpSpec]])) {
      (accFuture, term) =>
        accFuture.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(acc) =>
            resolveOneOp(schema, term, output, nodeSnapshotRepo).map(_.map(spec => acc :+ spec))
        }
    }

  /** D2/D3 (task 3.1), extended by HEL-1188 D3 — every NAMED `filter.columns` entry must resolve
   *  to a Structured column (`Left` on the first offender, naming it); the `quick` term is exempt
   *  from this rejection (D3) — it is matched only against whichever Structured columns exist,
   *  silently excluding any Content-category column from its own OR rather than erroring, since
   *  the caller never names a specific column for it. Absent/empty `filter` (no active quick term,
   *  no column terms, no ops) resolves to `None`, matching `listRowsPaged`'s existing unfiltered
   *  behavior exactly.
   *
   *  Now `Future`-returning (HEL-1188 D3) — `eq`/`in`'s on-demand cardinality check needs to reach
   *  `nodeSnapshotRepo`. `resolveSort` above is unaffected and stays synchronous. */
  def resolveFilter(
      output: Output,
      filter: Option[FilterParam],
      nodeSnapshotRepo: NodeSnapshotRepository
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Option[NodeSnapshotRepository.FilterSpec]]] = {
    val schema = output.schema
    filter match {
      case None => Future.successful(Right(None))
      case Some(FilterParam(quick, columns, ops)) =>
        columns.keys.find(col => sortCastForColumn(schema, col).isEmpty) match {
          case Some(badColumn) =>
            Future.successful(Left(ServiceError.BadRequest(s"column not filterable: '$badColumn'")))
          case None =>
            resolveOps(schema, ops, output, nodeSnapshotRepo).map {
              case Left(err) => Left(err)
              case Right(resolvedOps) =>
                val quickColumns = schema.filter(f => DataFieldType.fromString(f.`type`).flatMap(NodeSnapshotRepository.sortCastFor).isDefined).map(_.name)
                val hasQuick   = quick.exists(_.trim.nonEmpty)
                val hasColumns = columns.exists { case (_, term) => term.trim.nonEmpty }
                val hasOps     = resolvedOps.nonEmpty
                if (!hasQuick && !hasColumns && !hasOps) Right(None)
                else
                  Right(Some(NodeSnapshotRepository.FilterSpec(
                    quickTerm    = quick.filter(_.trim.nonEmpty),
                    quickColumns = quickColumns,
                    columnTerms  = columns,
                    ops          = resolvedOps
                  )))
            }
        }
    }
  }
}
