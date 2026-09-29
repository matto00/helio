package com.helio.services.pipelines

import com.helio.domain.model.DataFieldType
import com.helio.services.pipelines.OutputFilterCapability.Operator
import com.helio.services.pipelines.OutputFilterCapability.Operator._

/** HEL-1189 design.md D3 — the SINGLE source of truth for which output-panel control kinds
 *  (`date-range`/`dropdown`/`numeric-range`/`text`) a column is currently eligible for, given the
 *  operator set `OutputFilterCapability` already computed for that column (which folds in the
 *  eq/in cardinality gate) and the column's declared `DataFieldType`. Called by both the write-time
 *  validator (`PanelService.rejectInvalidControls`) and mirrored on the frontend
 *  (`state/outputControlEligibility.ts`, drift-guarded by
 *  `outputControlEligibilityDriftGuard.test.ts`, C4) — exactly the "shared logic, not a parallel
 *  copy" discipline `OutputFilterCapability` itself documents.
 *
 *  `KindRequirements` is the literal both sides mirror: each kind names the operators it requires
 *  and, when eligibility is also type-gated (numeric-range/date-range), the allowed
 *  `DataFieldType`s. `None` means "any type is fine, the operator set alone already encodes the
 *  type sensitivity via `OutputFilterCapability.staticOperatorsFor`" (text/dropdown). */
object OutputControlEligibility {

  /** design.md D2 — the four control kinds an output panel can offer. */
  val ValidKinds: Set[String] = Set("date-range", "dropdown", "numeric-range", "text")

  /** THE literal drift-guarded against `frontend/.../outputControlEligibility.ts`'s
   *  `KIND_REQUIREMENTS` (C4) — never edit one side without the other. */
  val KindRequirements: Map[String, (Set[Operator], Option[Set[DataFieldType]])] = Map(
    "text"          -> (Set(Contains), None),
    "dropdown"      -> (Set(Eq, In), None),
    "numeric-range" -> (Set(Gte, Lte), Some(Set(DataFieldType.IntegerType, DataFieldType.FloatType))),
    "date-range"    -> (Set(Gte, Lte), Some(Set(DataFieldType.TimestampType)))
  )

  /** Every control kind `column` (given its already-resolved `operators` set and declared
   *  `fieldType`) is currently eligible for. Pure and DB-free — the cardinality-based eq/in gate
   *  is already folded into `operators` by whoever resolved it
   *  (`OutputFilterCapability.buildContract`/`eqInEligibleColumn`), so this function never touches
   *  `NodeSnapshotRepository` itself. `column` is threaded through for parity with the design's
   *  stated signature and so a future caller can attach it to an error/log message; unused in the
   *  body since eligibility depends only on `operators`/`fieldType`. */
  def kindsFor(column: String, operators: Set[Operator], fieldType: DataFieldType): Set[String] =
    KindRequirements.collect {
      case (kind, (requiredOps, allowedTypes))
          if requiredOps.subsetOf(operators) && allowedTypes.forall(_.contains(fieldType)) =>
        kind
    }.toSet
}
