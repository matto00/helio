package com.helio.services.proposals

import com.helio.api.protocols.proposals.{ProposalPanel, ProposalPanelLayout}
import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutPolicy, LayoutValidator}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1834: `buildLayout(minRows)` lifts an authored sub-minimum item only when the space directly below is free. */
class ProposalLayoutSupportMinRowsSpec extends AnyWordSpec with Matchers {

  private def panel(title: String, layout: Option[(Int, Int, Int, Int)]): ProposalPanel =
    ProposalPanel(title, "text", None, None, None, None, None, None, None, None, None, None, None, None, None,
      layout.map { case (x, y, w, h) => ProposalPanelLayout(x, y, w, h) }, None)

  private def ids(n: Int) = (0 until n).toVector.map(i => PanelId(s"p$i"))
  private def lgOf(l: DashboardLayout, i: Int): DashboardLayoutItem = l.lg.find(_.panelId == PanelId(s"p$i")).get

  "ProposalLayoutSupport.buildLayout with minRows" should {
    "grow an authored 4-row item to 5 when nothing is below it" in {
      val l = ProposalLayoutSupport.buildLayout(Vector(panel("f", Some((0, 0, 6, 4)))), ids(1), minRows = Vector(5))
      lgOf(l, 0).h shouldBe 5
    }
    "keep 4 rows, and leave the neighbour where it is, when an authored panel sits directly below" in {
      val l = ProposalLayoutSupport.buildLayout(
        Vector(panel("f", Some((0, 0, 6, 4))), panel("b", Some((0, 4, 6, 3)))), ids(2), minRows = Vector(5, 1))
      (lgOf(l, 0).h, lgOf(l, 1).y, lgOf(l, 1).h) shouldBe ((4, 4, 3))
    }
    "grow when the panel below is in other columns" in {
      val l = ProposalLayoutSupport.buildLayout(
        Vector(panel("f", Some((0, 0, 4, 4))), panel("b", Some((4, 4, 4, 3)))), ids(2), minRows = Vector(5, 1))
      lgOf(l, 0).h shouldBe 5
    }
    "keep an item with no floor (minRows 1) at its authored height" in {
      val l = ProposalLayoutSupport.buildLayout(Vector(panel("c", Some((0, 0, 4, 4)))), ids(1), minRows = Vector(1))
      lgOf(l, 0).h shouldBe 4
    }
    "append an unauthored panel below the lifted bottom, and stay valid at every breakpoint" in {
      val l = ProposalLayoutSupport.buildLayout(Vector(panel("f", Some((0, 0, 6, 4))), panel("u", None)), ids(2), minRows = Vector(5, 1))
      lgOf(l, 1).y shouldBe 5
      LayoutPolicy.Breakpoints.foreach { bp =>
        LayoutValidator.violations(LayoutPolicy.stored(l, bp).map(LayoutValidator.toRect), LayoutBreakpointScaling.breakpointCols(bp)) shouldBe empty
      }
    }
    "resolve two stacked sub-minimum forms deterministically: the lower is lifted, the upper keeps 4" in {
      val l = ProposalLayoutSupport.buildLayout(
        Vector(panel("a", Some((0, 0, 6, 4))), panel("b", Some((0, 4, 6, 4)))), ids(2), minRows = Vector(5, 5))
      (lgOf(l, 0).h, lgOf(l, 1).h) shouldBe ((4, 5))
    }
  }
}
