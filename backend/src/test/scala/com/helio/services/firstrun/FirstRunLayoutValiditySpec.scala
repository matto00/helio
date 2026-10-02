package com.helio.services.firstrun

import com.helio.api.protocols.pipelines.ProposalOutputSummary
import com.helio.domain.model.PanelId
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutPolicy, LayoutValidator}
import com.helio.services.proposals.ProposalLayoutSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1071 audit: the first-run/persona dashboard builders are a layout write path (they flow through
 *  proposal apply). Their output must pass the same validator at every breakpoint. */
class FirstRunLayoutValiditySpec extends AnyWordSpec with Matchers {

  PersonaTemplates.All.foreach { template =>
    s"the ${template.slug} persona dashboard" should {
      "validate at lg and derive valid md/sm/xs layouts" in {
        val planned = template.pipelineProposal("src-1").fold(fail(_), identity)
        val created = planned.outputs.map(o => ProposalOutputSummary(s"out-${o.name}", o.name, o.kind, None))
        val proposal = FirstRunPlanner.dashboardProposal(template.dashboardName, planned, created, explicitChartTypes = true).fold(fail(_), identity)

        ProposalLayoutSupport.validate(proposal.panels) shouldBe Right(())
        val layout = ProposalLayoutSupport.buildLayout(proposal.panels, proposal.panels.indices.toVector.map(i => PanelId(s"panel-$i")))
        layout.lg should have size proposal.panels.size
        LayoutPolicy.Breakpoints.foreach { bp =>
          LayoutValidator.violations(LayoutPolicy.stored(layout, bp).map(LayoutValidator.toRect), LayoutBreakpointScaling.breakpointCols(bp)) shouldBe empty
        }
      }
    }
  }
}
