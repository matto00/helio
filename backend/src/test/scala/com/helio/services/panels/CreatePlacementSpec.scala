package com.helio.services.panels

import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class CreatePlacementSpec extends AnyWordSpec with Matchers {

  private def id(s: String) = PanelId(s)
  private def item(p: String, x: Int, y: Int, w: Int, h: Int) = DashboardLayoutItem(id(p), x, y, w, h)
  private val emptyLayout = DashboardLayout(Vector.empty, Vector.empty, Vector.empty, Vector.empty)

  "CreatePlacement.append" should {

    "stack panels at x = 0 below each breakpoint's own bottom, counting earlier panels of the same call" in {
      val layout = DashboardLayout(
        lg = Vector(item("a", 0, 0, 6, 2)),
        md = Vector(item("a", 0, 0, 5, 9)),
        sm = Vector.empty,
        xs = Vector(item("a", 0, 0, 2, 3), item("b", 0, 0, 2, 3)) // stored-bad: same cell
      )
      val (next, placed) = CreatePlacement.append(layout, Vector(id("n1") -> PlacementSizes.ContentDefault, id("n2") -> PlacementSizes.ContentDefault))
      placed.map(p => (p.lg.y, p.md.y, p.sm.y, p.xs.y)) shouldBe Vector((2, 9, 0, 3), (7, 14, 5, 8))
      next.xs.take(2) shouldBe layout.xs
      next.lg.size shouldBe 3
    }

    "give the content default 4/4/3/2 columns by 5 rows" in {
      val (_, placed) = CreatePlacement.append(emptyLayout, Vector(id("n") -> PlacementSizes.ContentDefault))
      placed.head.lg.w -> placed.head.xs.w shouldBe (4 -> 2)
      List(placed.head.lg, placed.head.md, placed.head.sm, placed.head.xs).map(_.h).distinct shouldBe List(5)
    }

    "scale an lg size per breakpoint, never wider than the grid and never below 1" in {
      val sizes = PlacementSizes.scaledFromLg(ItemSize(12, 3))
      (sizes.lg.w, sizes.md.w, sizes.sm.w, sizes.xs.w) shouldBe ((12, 10, 6, 2))
      PlacementSizes.scaledFromLg(ItemSize(1, 3)).xs.w shouldBe 1
    }
  }

  "CreatePlacement.duplicateSizes" should {
    val lgOnly = DashboardLayout(Vector(item("s", 0, 0, 6, 4)), Vector.empty, Vector.empty, Vector.empty)

    "prefer the source's stored item, clamping its width to the grid" in {
      val layout = lgOnly.copy(xs = Vector(item("s", 0, 0, 9, 7)))
      CreatePlacement.duplicateSizes(layout, id("s"), PlacementSizes.ContentDefault).xs shouldBe ItemSize(2, 7)
    }

    "scale the source's lg item where the source has no item at a breakpoint" in {
      val sizes = CreatePlacement.duplicateSizes(lgOnly, id("s"), PlacementSizes.ContentDefault)
      (sizes.lg, sizes.sm) shouldBe ((ItemSize(6, 4), ItemSize(3, 4)))
    }

    "fall back to the kind default when the source is orphaned everywhere" in {
      CreatePlacement.duplicateSizes(emptyLayout, id("s"), PlacementSizes.ContentDefault) shouldBe PlacementSizes.ContentDefault
    }
  }
}
