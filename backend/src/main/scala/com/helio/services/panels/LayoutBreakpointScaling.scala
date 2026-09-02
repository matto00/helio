package com.helio.services.panels

import com.helio.domain.model.DashboardLayoutItem

/** Shared breakpoint column widths + per-item scaling math, extracted (HEL-909
 *  cycle-3) so every backend write path that projects an item computed at one
 *  breakpoint's column count into another breakpoint's array uses the exact
 *  same formula — rather than each service re-deriving (or, as
 *  `AutoLayoutService` did, omitting) the scale/clamp step independently.
 *
 *  Mirrors the frontend's `projectLayout` (`frontend/src/features/dashboards/
 *  state/dashboardLayout.ts:139-150`) exactly: proportional scale, `w`
 *  clamped to `[1, targetCols]`, `x` clamped to `[0, targetCols - w]`. `y`/`h`
 *  are row-based (unitless across breakpoints) and carry over unchanged. */
object LayoutBreakpointScaling {

  /** Column count per breakpoint — must mirror the frontend's
   *  `dashboardGridCols` (`frontend/src/features/dashboards/state/
   *  dashboardLayout.ts`) exactly, or the two sides disagree about how wide
   *  a "full width" item is. */
  val breakpointCols: Map[String, Int] = Map("lg" -> 12, "md" -> 10, "sm" -> 6, "xs" -> 2)

  def scaleItemToBreakpoint(item: DashboardLayoutItem, sourceCols: Int, targetCols: Int): DashboardLayoutItem = {
    val scale = targetCols.toDouble / sourceCols.toDouble
    val w     = math.max(1, math.min(targetCols, math.round(item.w * scale).toInt))
    val x     = math.max(0, math.min(targetCols - w, math.round(item.x * scale).toInt))
    item.copy(x = x, w = w)
  }

  def scaleItemsToBreakpoint(items: Vector[DashboardLayoutItem], sourceCols: Int, targetCols: Int): Vector[DashboardLayoutItem] =
    items.map(scaleItemToBreakpoint(_, sourceCols, targetCols))

  /** Same `w`/`x` scale-and-clamp math as [[scaleItemToBreakpoint]], but on
   *  raw `(x, w)` ints rather than a `DashboardLayoutItem` — for callers
   *  (e.g. `DashboardProposalService`/`DashboardContentsService`) working
   *  with a wire-protocol payload type rather than the domain model. */
  def scaleWidthAndX(x: Int, w: Int, sourceCols: Int, targetCols: Int): (Int, Int) = {
    val scale    = targetCols.toDouble / sourceCols.toDouble
    val scaledW  = math.max(1, math.min(targetCols, math.round(w * scale).toInt))
    val scaledX  = math.max(0, math.min(targetCols - scaledW, math.round(x * scale).toInt))
    (scaledX, scaledW)
  }
}
