package com.helio.services.panels

import com.helio.domain.model.{DashboardLayoutItem, PanelId}
import com.helio.services.panels.LayoutReflow.Source
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Random

/** HEL-1071: reflow is valid by construction at every breakpoint, for any input. */
class LayoutReflowSpec extends AnyWordSpec with Matchers {

  private def violationsAt(items: Vector[DashboardLayoutItem], cols: Int) =
    LayoutValidator.violations(items.map(LayoutValidator.toRect), cols)

  "LayoutReflow.reflow" should {
    "stack three 4-wide tiles into two columns without overlap (the roadmap xs case)" in {
      val tiles = Vector("m1", "m2", "m3").zipWithIndex.map { case (id, i) => Source(PanelId(id), i * 4, 0, 4, 3) }
      val xs    = LayoutReflow.reflow(tiles, 12, 2)
      violationsAt(xs, 2) shouldBe empty
      xs.map(_.panelId.value) shouldBe Vector("m1", "m2", "m3")
    }

    "keep input order in the result while flowing in lg reading order" in {
      val items = Vector(Source(PanelId("low"), 0, 10, 12, 2), Source(PanelId("top"), 0, 0, 12, 2))
      val out   = LayoutReflow.reflow(items, 12, 6)
      out.map(_.panelId.value) shouldBe Vector("low", "top")
      out.find(_.panelId.value == "top").get.y should be < out.find(_.panelId.value == "low").get.y
    }

    "produce zero violations at every breakpoint for random inputs, including w > cols and h < 1" in {
      val rnd = new Random(1071)
      for (_ <- 1 to 300) {
        val n = rnd.nextInt(15)
        val sources = (0 until n).toVector.map { i =>
          Source(PanelId(s"p$i"), rnd.nextInt(12), rnd.nextInt(30), rnd.nextInt(20) - 2, rnd.nextInt(10) - 1)
        }
        LayoutBreakpointScaling.breakpointCols.foreach { case (bp, cols) =>
          withClue(s"$bp $sources: ") {
            violationsAt(LayoutReflow.reflow(sources, 12, cols), cols) shouldBe empty
          }
        }
      }
    }
  }

  "PanelPacker.clamp" should {
    "never exceed cols even when the kind's minimum width is wider than the grid" in {
      // an Output has minW 4; at 2 columns the item must be 2 wide, not 4
      PanelPacker.clamp("output", 4, 6, 2)._1 shouldBe 2
      PanelPacker.clamp("output", 12, 6, 6)._1 shouldBe 6
      PanelPacker.clamp("output", 2, 6, 12)._1 shouldBe 4 // the floor still applies when it fits
    }
  }

  "PanelPacker.pack at 2 columns" should {
    "emit no overflow or overlap for random sizes" in {
      val rnd = new Random(7)
      for (_ <- 1 to 200) {
        val inputs = (0 until rnd.nextInt(12)).toVector.map { i =>
          PanelPacker.PackInput(PanelId(s"p$i"), "output", 1 + rnd.nextInt(12), 1 + rnd.nextInt(12))
        }
        LayoutBreakpointScaling.breakpointCols.values.foreach { cols =>
          violationsAt(PanelPacker.pack(inputs, cols), cols) shouldBe empty
        }
      }
    }
  }
}
