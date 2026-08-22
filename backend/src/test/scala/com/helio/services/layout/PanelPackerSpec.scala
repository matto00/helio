package com.helio.services.layout

import com.helio.domain.model.{DashboardLayoutItem, PanelId, PanelKind}
import com.helio.services.panels.PanelPacker
import com.helio.services.panels.PanelPacker.PackInput
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Random

/** Unit coverage for the pure packer module (HEL-367, tasks 4.1/4.2). No
 *  HTTP/DB — mirrors [[PanelPacker]]'s own zero-dependency scope.
 *
 *  helio-news reference (`~/Development/helio-news/news/run.py`) ported
 *  verbatim per design.md D4; task 4.2's overlap-freedom property is a
 *  hand-rolled generator loop (design.md D5's fallback — no ScalaCheck
 *  dependency in `backend/build.sbt` at implementation time). */
class PanelPackerSpec extends AnyWordSpec with Matchers {

  private def input(id: String, kind: String, w: Int, h: Int): PackInput =
    PackInput(PanelId(id), kind, w, h)

  private def overlaps(a: DashboardLayoutItem, b: DashboardLayoutItem): Boolean =
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  private def noPairwiseOverlaps(items: Vector[DashboardLayoutItem]): Boolean =
    items.combinations(2).forall(pair => !overlaps(pair(0), pair(1)))

  "pack" should {

    "return an empty result for empty input" in {
      PanelPacker.pack(Vector.empty, cols = 12) shouldBe empty
    }

    "place a single panel at the origin" in {
      val result = PanelPacker.pack(Vector(input("p1", PanelKind.Chart, w = 6, h = 8)), cols = 12)
      result should have size 1
      result.head.x shouldBe 0
      result.head.y shouldBe 0
    }

    "wrap an overflowing item to a new shelf below the tallest item in the previous row" in {
      // 7 + 7 > 12 -> the second item wraps. Both widths clear the chart
      // minW=4, so clamping doesn't interfere with this scenario.
      val items = Vector(
        input("p1", PanelKind.Chart, w = 7, h = 6),
        input("p2", PanelKind.Chart, w = 7, h = 9)
      )
      val result = PanelPacker.pack(items, cols = 12)
      val byId   = result.map(i => i.panelId.value -> i).toMap

      byId("p1").x shouldBe 0
      byId("p1").y shouldBe 0
      byId("p2").x shouldBe 0
      byId("p2").y shouldBe 6 // below p1's height, not p1's (post-fill) width
      noPairwiseOverlaps(result) shouldBe true
    }

    "preserve input order as visual (left-to-right, top-to-bottom) order and be deterministic" in {
      val items = Vector(
        input("p1", PanelKind.Metric, w = 3, h = 3),
        input("p2", PanelKind.Metric, w = 3, h = 3),
        input("p3", PanelKind.Metric, w = 3, h = 3)
      )
      val first  = PanelPacker.pack(items, cols = 12)
      val second = PanelPacker.pack(items, cols = 12)
      first shouldBe second // byte-identical on repeat

      first.map(_.panelId.value) shouldBe Vector("p1", "p2", "p3")
      first(0).x should be <= first(1).x
      first(1).x should be <= first(2).x
    }

    "widen a nearly-full shelf's items proportionally to close the ragged edge" in {
      // Two markdown panels (minW=3) summing to 10 of 12 -> at/above the
      // fill threshold (round(12*7/12)=7) and below cols -> widened flush.
      val items = Vector(
        input("p1", PanelKind.Markdown, w = 5, h = 5),
        input("p2", PanelKind.Markdown, w = 5, h = 5)
      )
      val result = PanelPacker.pack(items, cols = 12)
      result.map(_.w).sum shouldBe 12
      noPairwiseOverlaps(result) shouldBe true
    }

    "leave a sparse shelf's single item unchanged" in {
      val result = PanelPacker.pack(Vector(input("p1", PanelKind.Markdown, w = 3, h = 5)), cols = 12)
      result.head.w shouldBe 3
    }

    "raise an undersized chart's height to the chart kind's minimum" in {
      val result = PanelPacker.pack(Vector(input("p1", PanelKind.Chart, w = 6, h = 2)), cols = 12)
      result.head.h shouldBe 6 // chart minH
    }

    "lower an oversized metric's height to the metric kind's maximum" in {
      val result = PanelPacker.pack(Vector(input("p1", PanelKind.Metric, w = 3, h = 20)), cols = 12)
      result.head.h shouldBe 5 // metric maxH
    }

    "raise an undersized panel's width to its kind's minimum" in {
      val result = PanelPacker.pack(Vector(input("p1", PanelKind.Table, w = 1, h = 5)), cols = 12)
      result.head.w shouldBe 3 // table minW
    }

    "apply the default bounds for a kind with no configured entry" in {
      val result = PanelPacker.pack(Vector(input("p1", PanelKind.Text, w = 0, h = 0)), cols = 12)
      result.head.w shouldBe 1 // default minW
      result.head.h shouldBe 2 // default minH
    }
  }

  "clamp" should {
    "never let width exceed cols" in {
      PanelPacker.clamp(PanelKind.Table, w = 999, h = 5, cols = 12) shouldBe (12, 5)
    }
  }

  "overlap-freedom property" should {
    "hold for many randomly generated (kind, w, h) lists, including out-of-bounds sizes" in {
      val kinds = Vector(
        PanelKind.Metric, PanelKind.Chart, PanelKind.Table, PanelKind.Collection,
        PanelKind.Image, PanelKind.Markdown, PanelKind.Text, PanelKind.Divider, PanelKind.Timeline
      )
      val seeds = 1 to 200

      seeds.foreach { seed =>
        val rnd   = new Random(seed.toLong)
        val count = rnd.nextInt(15) + 1 // 1..15 panels
        val items = (1 to count).map { i =>
          val kind = kinds(rnd.nextInt(kinds.length))
          // Deliberately range past every kind's bounds (including 0 and
          // negative) so clamping is exercised, not just in-bounds sizes.
          val w = rnd.nextInt(16) - 2
          val h = rnd.nextInt(16) - 2
          input(s"panel-$seed-$i", kind, w, h)
        }.toVector

        val result = PanelPacker.pack(items, cols = 12)
        withClue(s"seed=$seed items=$items result=$result") {
          noPairwiseOverlaps(result) shouldBe true
          result should have size items.size
        }
      }
    }
  }
}
