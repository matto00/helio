package com.helio.domain.shapes

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

/** A [[PipelineShape]]'s guaranteed output shape — the "output-contract summary" panels
 *  (HEL-402) bind to. There is no statically-declared field list: a prior `OutputFieldContract`/
 *  `fields: Vector[OutputFieldContract]` member was removed as YAGNI (HEL-623) — it had zero
 *  producers and zero consumers across the shipped shape epic, and structurally could never be
 *  populated correctly since `outputContract` is a static `val` with no access to `params`. Any
 *  surface needing a shape's actual output columns binds via the runtime `DataType` schema
 *  produced after instantiate → run (HEL-399), not a static field declaration. */
final case class OutputContract(
    rowCount: RowCountContract,
    description: String
)
