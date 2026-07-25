package com.helio.domain.shapes

import com.helio.domain.DataFieldType

/** The row-count guarantee a [[PipelineShape]] declares for its output — shape-level (declared once
 *  on the trait), not computed per-invocation (HEL-391 design.md Decision 2). A small, `sealed`
 *  closed set (confirmed as the right call in HEL-393 design.md Decision 6 — `single-row` is the
 *  first real consumer of the `ExactlyOne` case below): every consumer (this file's tests, the
 *  catalog protocol) matches exhaustively over the three known cases, and a genuinely new case can
 *  only be added in a follow-up PR to this same file.
 *
 *    - `ExactlyOne`: the shape always produces exactly one row (e.g. a future single-row shape).
 *    - `AtMostParam(paramName)`: bounded by a caller-supplied param whose value isn't known until
 *      `expand`-time (e.g. a future top-N shape bounded by its `"n"` param).
 *    - `Unbounded`: row count is data-dependent (e.g. a future time-series/pivot shape, or this
 *      ticket's `passthrough` reference shape).
 */
sealed trait RowCountContract

object RowCountContract {
  case object ExactlyOne extends RowCountContract
  final case class AtMostParam(paramName: String) extends RowCountContract
  case object Unbounded extends RowCountContract
}

/** One statically-known output field a [[PipelineShape]] guarantees. Three fields only — an earlier
 *  draft added a `role: String` field with no defined vocabulary, no precedent, and no consumer
 *  (this ticket's `passthrough` shape never populates it); dropped for YAGNI after design-gate
 *  round 2 (HEL-391 design.md). A future ticket with a real, load-bearing need for field-role
 *  semantics (e.g. "which field is the time axis") can add it then, with a defined vocabulary and a
 *  reference shape that actually exercises it. */
final case class OutputFieldContract(name: String, dataType: DataFieldType, nullable: Boolean)

/** A [[PipelineShape]]'s guaranteed output shape — the "output-contract summary" panels
 *  (HEL-402) bind to. `fields` MAY be empty when the output field set is fully determined by
 *  caller-supplied params rather than fixed by the shape itself (true for this ticket's
 *  `passthrough` reference shape). */
final case class OutputContract(
    rowCount: RowCountContract,
    fields: Vector[OutputFieldContract],
    description: String
)
