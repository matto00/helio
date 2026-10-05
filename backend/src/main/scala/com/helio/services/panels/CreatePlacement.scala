package com.helio.services.panels

import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}

/** The size one new panel takes in one breakpoint. */
final case class ItemSize(w: Int, h: Int)

/** The size one new panel takes in each breakpoint. */
final case class PlacementSizes(lg: ItemSize, md: ItemSize, sm: ItemSize, xs: ItemSize) {
  def get(bp: String): ItemSize = bp match {
    case "lg" => lg
    case "md" => md
    case "sm" => sm
    case "xs" => xs
  }
}

object PlacementSizes {

  private val ContentHeight = 5

  /** What the client has always rendered an unplaced panel at (`defaultItemWidth` x 5 in
   *  `dashboardLayout.ts`): 4/4/3/2 columns wide, so a new content panel keeps the size it already
   *  showed, and stays full width on the 2-column phone grid. */
  val ContentDefault: PlacementSizes = {
    def at(bp: String): ItemSize = {
      val cols = LayoutBreakpointScaling.breakpointCols(bp)
      ItemSize(if (cols >= 10) 4 else if (cols >= 6) 3 else 2, ContentHeight)
    }
    PlacementSizes(at("lg"), at("md"), at("sm"), at("xs"))
  }

  /** An lg-sized item scaled to each breakpoint's column count (never wider than the grid). */
  def scaledFromLg(lg: ItemSize): PlacementSizes = {
    def at(bp: String): ItemSize = {
      val cols = LayoutBreakpointScaling.breakpointCols(bp)
      val lgCols = LayoutBreakpointScaling.breakpointCols("lg")
      ItemSize(math.max(1, math.min(cols, math.round(lg.w.toDouble * cols / lgCols).toInt)), lg.h)
    }
    PlacementSizes(lg, at("md"), at("sm"), at("xs"))
  }
}

/** Create-time placement (HEL-1260): the single pure placer for every path that creates a panel on
 *  an existing dashboard (single create, batch create, duplicate).
 *
 *  Each panel is appended to every breakpoint at `x = 0`, below that breakpoint's own bottom, counting
 *  items placed earlier in the same call. Starting below every stored item means a placed item never
 *  overlaps anything, so a valid breakpoint stays valid and a stored-bad one only gains a
 *  non-overlapping item. */
object CreatePlacement {

  /** `layout` with one item appended per panel in every breakpoint, plus the items placed per panel. */
  def append(
      layout: DashboardLayout,
      panels: Vector[(PanelId, PlacementSizes)]
  ): (DashboardLayout, Vector[PlacedLayouts]) = {
    def stack(bp: String): Vector[DashboardLayoutItem] = {
      val start = (LayoutPolicy.stored(layout, bp).map(i => i.y + i.h) :+ 0).max
      panels.foldLeft((start, Vector.empty[DashboardLayoutItem])) { case ((y, acc), (id, sizes)) =>
        val size = sizes.get(bp)
        (y + size.h, acc :+ DashboardLayoutItem(id, x = 0, y = y, w = size.w, h = size.h))
      }._2
    }
    val placed = LayoutPolicy.Breakpoints.map(bp => bp -> stack(bp)).toMap
    val next = DashboardLayout(
      lg = layout.lg ++ placed("lg"),
      md = layout.md ++ placed("md"),
      sm = layout.sm ++ placed("sm"),
      xs = layout.xs ++ placed("xs")
    )
    val perPanel = panels.indices.toVector.map { i =>
      PlacedLayouts(placed("lg")(i), placed("md")(i), placed("sm")(i), placed("xs")(i))
    }
    (next, perPanel)
  }

  /** A duplicate's size per breakpoint, first that applies: the source's stored item there (width
   *  clamped to the grid); else the source's stored lg item scaled to that breakpoint; else the
   *  source kind's default size. */
  def duplicateSizes(layout: DashboardLayout, sourceId: PanelId, kindDefault: PlacementSizes): PlacementSizes = {
    def storedFor(bp: String): Option[DashboardLayoutItem] = LayoutPolicy.stored(layout, bp).find(_.panelId == sourceId)
    val scaledLg = storedFor("lg").map(i => PlacementSizes.scaledFromLg(ItemSize(i.w, math.max(1, i.h))))
    def at(bp: String): ItemSize = {
      val cols = LayoutBreakpointScaling.breakpointCols(bp)
      storedFor(bp).map(i => ItemSize(math.max(1, math.min(cols, i.w)), math.max(1, i.h)))
        .orElse(scaledLg.map(_.get(bp)))
        .getOrElse(kindDefault.get(bp))
    }
    PlacementSizes(at("lg"), at("md"), at("sm"), at("xs"))
  }
}
