package com.helio.services.panels

import com.helio.domain.panels.OutputControlSpec
import com.helio.services.pipelines.OutputRowsQuery

/** HEL-1190 design.md D5/D6 (owner ruling C11) — the SINGLE gate deciding whether an
 *  anonymous/share-token caller may name a given Output column in a filter, distinct-values, or
 *  filter-capabilities request against a specific panel on the public/optional-auth route tree:
 *  the column must be the bound `column` of one of THAT panel's own configured `output_controls`
 *  (HEL-1189) — never any other Output-eligible column, even one that would otherwise pass
 *  `OutputFilterCapability`'s own eligibility checks. Shared by `PublicDashboardRoutes`'s public
 *  rows/filter-capabilities/distinct-values resolution so the three surfaces can't independently
 *  drift on what "allowed" means (mirrors `OutputFilterCapability`'s own "one shared gate, three
 *  callers" shape for the authenticated tree). Never consulted on the authenticated
 *  `outputs/:id` route family — a signed-in owner/editor/viewer is bound only by
 *  `OutputFilterCapability`'s own eligibility, not this panel-scoped narrowing. */
object PublicOutputControlScope {

  def allowedColumns(controls: Vector[OutputControlSpec]): Set[String] = controls.map(_.column).toSet

  def isAllowed(controls: Vector[OutputControlSpec], column: String): Boolean =
    allowedColumns(controls).contains(column)

  /** Every column named by `filter`'s `columns` keys or `ops[]` entries. `quick` is NOT here: it
   *  matches across every sortable column, so it is rejected outright on the public tree
   *  (`validateFilterColumns`) rather than column-checked — owner ruling C11 is literal. */
  private def namedColumns(filter: OutputRowsQuery.FilterParam): Set[String] =
    filter.columns.keySet ++ filter.ops.map(_.column).toSet

  /** `Left` names the first offending column not on `controls`' own allow-list — checked BEFORE
   *  `OutputRowsQuery.resolveFilter`/`OutputFilterCapability` ever run, so a non-control column is
   *  rejected even when it IS a valid, filterable Output column (D5/D6's whole point: this is a
   *  strict ADDITIONAL narrowing on top of the existing eq/in-eligibility check, never a
   *  replacement for it). */
  def validateFilterColumns(
      controls: Vector[OutputControlSpec],
      filter: Option[OutputRowsQuery.FilterParam]
  ): Either[String, Unit] =
    filter match {
      case None => Right(())
      case Some(f) if f.quick.exists(_.trim.nonEmpty) =>
        Left("quick filter is not permitted on a public panel")
      case Some(f) =>
        val allowed = allowedColumns(controls)
        namedColumns(f).find(col => !allowed.contains(col)) match {
          case Some(badColumn) => Left(s"column not permitted for this panel: '$badColumn'")
          case None            => Right(())
        }
    }

  /** `sort` on the public tree is likewise limited to the panel's own control columns (C11). */
  def validateSortColumn(controls: Vector[OutputControlSpec], sort: Option[OutputRowsQuery.SortParam]): Either[String, Unit] =
    sort match {
      case Some(s) if !isAllowed(controls, s.column) => Left(s"column not permitted for this panel: '${s.column}'")
      case _                                          => Right(())
    }
}
