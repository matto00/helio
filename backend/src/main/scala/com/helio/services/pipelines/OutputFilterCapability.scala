package com.helio.services.pipelines

import com.helio.domain.model.{DataFieldType, FieldTypeCategory, Output}
import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1188 design.md D2/D5 — the SHARED per-column filter-eligibility logic behind both
 *  `GET /api/outputs/:id/filter-capabilities` and `GET /api/outputs/:id/rows`'s own `ops[]`
 *  validation (and `GET /api/outputs/:id/distinct-values`'s eligibility gate). Every one of those
 *  three call sites resolves eligibility through the functions on this object -- never a second,
 *  hand-maintained copy of the eligibility rule -- which is what makes "the contract and the rows
 *  endpoint can't drift" (the ticket's own AC) true by construction rather than by convention.
 *
 *  Kept as its own file, sibling to `OutputRowsQuery.scala`, rather than folded into
 *  `OutputService.scala`/`NodeSnapshotRepository.scala` -- both of those files are already over
 *  CONTRIBUTING.md's 250-line soft budget (HEL-1187, filed as a HEL-1027 follow-up, still
 *  unstarted) and gain only thin call-through methods from this ticket (design.md D5). */
object OutputFilterCapability {

  /** D2 — every operator `GET /api/outputs/:id/rows`'s `filter` can accept, and
   *  `GET /api/outputs/:id/filter-capabilities` can report. `Contains` is never constructed from
   *  an `ops[]` entry (it is the pre-existing `quick`/`columns` shape, untouched by this ticket) --
   *  it exists on this ADT only so the capability-contract response can list it alongside the
   *  other four. */
  sealed trait Operator
  object Operator {
    case object Contains extends Operator
    case object Eq       extends Operator
    case object In       extends Operator
    case object Gte      extends Operator
    case object Lte      extends Operator

    def asString(op: Operator): String = op match {
      case Contains => "contains"
      case Eq       => "eq"
      case In       => "in"
      case Gte      => "gte"
      case Lte      => "lte"
    }

    def fromString(s: String): Option[Operator] = s match {
      case "contains" => Some(Contains)
      case "eq"       => Some(Eq)
      case "in"       => Some(In)
      case "gte"      => Some(Gte)
      case "lte"      => Some(Lte)
      case _          => None
    }

    /** A fixed, stable display order for a `Set[Operator]` -- `Set`'s own iteration order is not
     *  guaranteed, and a wire response listing operators in an arbitrary order would make byte-for-
     *  byte response comparisons (tests, client caching) needlessly flaky. */
    private val DisplayOrder: Vector[Operator] = Vector(Contains, Gte, Lte, Eq, In)

    def orderedWireStrings(ops: Set[Operator]): Vector[String] =
      DisplayOrder.filter(ops.contains).map(asString)
  }

  /** D2 point 2 — a dropdown with more than this many options stops being a usable control. A
   *  deliberate new number, not derived from any existing constant in this codebase (design.md D2).
   *  Shared identically by the capability-contract build, the rows endpoint's on-demand `eq`/`in`
   *  check, and the distinct-values cap/order-by -- the single source of truth for "how many
   *  distinct values is too many for a dropdown." */
  val MaxDropdownCardinality: Int = 50

  def cardinalityEligible(count: Int, cap: Int = MaxDropdownCardinality): Boolean = count <= cap

  /** D2 point 1 — the TYPE-based gate: zero DB cost, derived purely from the column's declared
   *  `DataFieldType`. `contains` is available on every Structured column (HEL-1027, carried
   *  forward verbatim); `gte`/`lte` are meaningless on `string`/`boolean` so are withheld there.
   *  `eq`/`in` are NOT decided here -- they are the cardinality-based gate below, D2's own
   *  "two independent gates" split. Every `DataFieldType` case is enumerated explicitly so a
   *  future eighth case fails to compile here first, mirroring `NodeSnapshotRepository.sortCastFor`'s
   *  own exhaustiveness discipline. */
  def staticOperatorsFor(fieldType: DataFieldType): Set[Operator] = fieldType match {
    case DataFieldType.StringType | DataFieldType.BooleanType =>
      Set(Operator.Contains)
    case DataFieldType.IntegerType | DataFieldType.FloatType | DataFieldType.TimestampType =>
      Set(Operator.Contains, Operator.Gte, Operator.Lte)
    case DataFieldType.StringBodyType | DataFieldType.BinaryRefType =>
      Set.empty
  }

  final case class ColumnCapability(column: String, operators: Set[Operator])
  final case class FilterCapabilityContract(columns: Vector[ColumnCapability])

  /** D5/D7 — full-schema contract build for `GET /api/outputs/:id/filter-capabilities`: one
   *  `distinctValueCountCapped` scan per Structured column in `output.schema` (D7's own honestly-
   *  stated `O(columns x row-count)` cost -- see that decision for why no index resolves it).
   *  Columns are checked SEQUENTIALLY (a `foldLeft` over `Future`, not `Future.traverse`) rather
   *  than fired concurrently -- this ticket's own cost model is already expensive per call; fanning
   *  every column's scan out in parallel would multiply the instantaneous DB load for no benefit
   *  (this endpoint's own D6 rationale: it is called once per panel load/config-open, not the hot
   *  `/rows` path). A Content-category or absent column never reaches this method at all --
   *  `output.schema` is filtered to Structured columns before the loop -- so the omission the
   *  ticket's own AC requires ("a Content-category or undeclared column is omitted entirely") holds
   *  structurally, not by a later filter. */
  def buildContract(output: Output, nodeSnapshotRepo: NodeSnapshotRepository)(implicit
      ec: ExecutionContext
  ): Future[FilterCapabilityContract] = {
    val structuredColumns: Vector[(String, DataFieldType)] =
      output.schema.flatMap { field =>
        DataFieldType.fromString(field.`type`).collect {
          case t if DataFieldType.category(t) == FieldTypeCategory.Structured => field.name -> t
        }
      }

    val resultFuture: Future[Vector[ColumnCapability]] =
      structuredColumns.foldLeft(Future.successful(Vector.empty[ColumnCapability])) { (accFuture, columnAndType) =>
        val (column, fieldType) = columnAndType
        accFuture.flatMap { acc =>
          nodeSnapshotRepo
            .distinctValueCountCapped(
              output.node.pipelineId.value,
              output.node.stepId.map(_.value),
              output.node.rootId.map(_.value),
              column,
              MaxDropdownCardinality + 1
            )
            .map { distinctCount =>
              val staticOps = staticOperatorsFor(fieldType)
              val operators =
                if (cardinalityEligible(distinctCount)) staticOps ++ Set(Operator.Eq, Operator.In)
                else staticOps
              acc :+ ColumnCapability(column, operators)
            }
        }
      }

    // Every Structured column already carries `contains` unconditionally (staticOperatorsFor never
    // returns an empty set for a Structured type) -- this filter is a stated-in-design safety net
    // (D5: "omitting any column left with an empty operator set"), not load-bearing today.
    resultFuture.map(cols => FilterCapabilityContract(cols.filter(_.operators.nonEmpty)))
  }

  /** D5 — the ONE-column on-demand check `OutputRowsQuery.resolveFilter`'s `eq`/`in` branch and
   *  `GET /api/outputs/:id/distinct-values` both call, instead of computing the whole contract just
   *  to check one column (D6's stated reason: `/rows` is the hot path). Self-contained: re-derives
   *  presence-in-schema and Structured-category from `output.schema` itself, so a caller that has
   *  NOT already validated the column (`distinct-values`'s route) gets a correct, defined 400 just
   *  as reliably as `resolveFilter`'s already-validated caller does. */
  def eqInEligibleColumn(output: Output, nodeSnapshotRepo: NodeSnapshotRepository, column: String)(implicit
      ec: ExecutionContext
  ): Future[Either[ServiceError, Unit]] =
    output.schema.find(_.name == column).flatMap(f => DataFieldType.fromString(f.`type`)) match {
      case Some(fieldType) if DataFieldType.category(fieldType) == FieldTypeCategory.Structured =>
        nodeSnapshotRepo
          .distinctValueCountCapped(
            output.node.pipelineId.value,
            output.node.stepId.map(_.value),
            output.node.rootId.map(_.value),
            column,
            MaxDropdownCardinality + 1
          )
          .map { distinctCount =>
            if (cardinalityEligible(distinctCount)) Right(())
            else Left(ServiceError.BadRequest(s"column not eq/in-eligible: '$column'"))
          }
      case _ =>
        Future.successful(Left(ServiceError.BadRequest(s"column not eq/in-eligible: '$column'")))
    }
}
