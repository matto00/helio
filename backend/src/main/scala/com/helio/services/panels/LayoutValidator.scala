package com.helio.services.panels

import com.helio.domain.model.DashboardLayoutItem

/** Pure geometry validator for one breakpoint's layout (HEL-1071). Mirrors the
 *  frontend `breakpointLayout.ts` contract exactly (`rectsOverlap`, `findOverlaps`,
 *  `isItemInBounds`, `isLayoutValid`): an item is in bounds when `x >= 0`, `y >= 0`,
 *  `w >= 1`, `h >= 1`, `x + w <= cols`; two items overlap when they share any grid
 *  cell (strict inequalities, touching edges are fine). Both sides are asserted
 *  against the one shared fixture `shared-test-fixtures/layout-validity.json`.
 *
 *  Ids are plain strings so callers that have no panel ids yet (a proposal's panels)
 *  can validate under a label of their choosing. */
object LayoutValidator {

  final case class Rect(id: String, x: Int, y: Int, w: Int, h: Int)

  sealed trait Violation { def panelIds: Vector[String] }
  /** `[earlier, later]` in input order, like the frontend's `findOverlaps`. */
  final case class Overlap(a: String, b: String) extends Violation { def panelIds: Vector[String] = Vector(a, b) }
  final case class OutOfBounds(panelId: String, reason: String) extends Violation { def panelIds: Vector[String] = Vector(panelId) }

  def toRect(item: DashboardLayoutItem): Rect = Rect(item.panelId.value, item.x, item.y, item.w, item.h)

  /** Same predicate as the frontend `rectsOverlap`. */
  def rectsOverlap(a: Rect, b: Rect): Boolean =
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  /** Same predicate as the frontend `isItemInBounds`. */
  def isInBounds(item: Rect, cols: Int): Boolean =
    item.x >= 0 && item.y >= 0 && item.w >= 1 && item.h >= 1 && item.x + item.w <= cols

  private def boundsReason(item: Rect, cols: Int): String =
    s"x=${item.x}, y=${item.y}, w=${item.w}, h=${item.h} in a $cols-column grid"

  /** Out-of-bounds items first (input order), then every overlapping pair (input order). */
  def violations(items: Vector[Rect], cols: Int): Vector[Violation] = {
    val oob = items.filterNot(isInBounds(_, cols)).map(i => OutOfBounds(i.id, boundsReason(i, cols)))
    val overlaps = for {
      i <- items.indices.toVector
      j <- (i + 1) until items.length
      if rectsOverlap(items(i), items(j))
    } yield Overlap(items(i).id, items(j).id)
    oob ++ overlaps
  }

  def isValid(items: Vector[Rect], cols: Int): Boolean = violations(items, cols).isEmpty

  def describe(v: Violation): String = v match {
    case Overlap(a, b)        => s"panels '$a' and '$b' overlap"
    case OutOfBounds(id, why) => s"panel '$id' is out of bounds ($why)"
  }
}
