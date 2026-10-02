package com.helio.services.panels

import com.helio.domain.model.{DashboardLayoutItem, PanelId}

/** Valid-by-construction derivation of a narrower breakpoint's layout (HEL-1071).
 *
 *  Replaces proportional x/w scaling for system-generated paths (proposal apply, contents
 *  replace): scaling a 12-column placement into 2 columns keeps `y` and collapses distinct
 *  columns onto the same cell, producing overlaps. Here widths are scaled and clamped to
 *  `[1, targetCols]`, then items are flowed left-to-right in lg reading order (y, x, input
 *  index) on shelves that wrap at `targetCols`, so the result never overlaps or overflows. */
object LayoutReflow {

  final case class Source(panelId: PanelId, x: Int, y: Int, w: Int, h: Int)

  def reflow(items: Vector[Source], sourceCols: Int, targetCols: Int): Vector[DashboardLayoutItem] = {
    val order = items.zipWithIndex.sortBy { case (s, i) => (s.y, s.x, i) }
    val placed = new Array[DashboardLayoutItem](items.length)
    var x      = 0
    var y      = 0
    var shelfH = 0
    order.foreach { case (s, index) =>
      val w = math.max(1, math.min(targetCols, math.round(s.w.toDouble * targetCols / sourceCols).toInt))
      val h = math.max(1, s.h)
      if (x + w > targetCols) {
        y += shelfH
        x = 0
        shelfH = 0
      }
      placed(index) = DashboardLayoutItem(s.panelId, x, y, w, h)
      x += w
      shelfH = math.max(shelfH, h)
    }
    placed.toVector
  }

  def fromItems(items: Vector[DashboardLayoutItem]): Vector[Source] =
    items.map(i => Source(i.panelId, i.x, i.y, i.w, i.h))
}
