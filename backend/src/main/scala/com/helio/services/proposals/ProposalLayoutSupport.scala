package com.helio.services.proposals

import com.helio.api.protocols.proposals.ProposalPanel
import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutPolicy, LayoutReflow, LayoutValidator}

/** Layout handling shared by `DashboardProposalService` (apply) and `DashboardContentsService`
 *  (replace contents) — HEL-1071. A proposal carries only an authored `lg` placement per panel
 *  (all-or-none is NOT required: panels without one are left for the frontend to place). The lg
 *  items are validated BEFORE anything is created (reject, never clamp; the offending panels are
 *  named by position/title because their ids do not exist yet), and md/sm/xs are derived with
 *  [[LayoutReflow]] so they are valid by construction. */
object ProposalLayoutSupport {

  private val LgCols = LayoutBreakpointScaling.breakpointCols("lg")

  /** `Left(message)` naming `lg` and the offending proposal panels; no side effects. */
  def validate(panels: Vector[ProposalPanel]): Either[String, Unit] = {
    val rects = panels.zipWithIndex.flatMap { case (p, idx) =>
      p.layout.map(l => LayoutValidator.Rect(s"panel ${idx + 1} ('${p.title}')", l.x, l.y, l.w, l.h))
    }
    val vs = LayoutValidator.violations(rects, LgCols).map("lg" -> _)
    if (vs.isEmpty) Right(()) else Left(LayoutPolicy.message(vs))
  }

  /** The full layout for the created panels `builtIds` (same order as `proposalPanels`); panels with
   *  no layout are omitted. */
  def buildLayout(proposalPanels: Vector[ProposalPanel], builtIds: Vector[PanelId]): DashboardLayout = {
    val lg = proposalPanels.zip(builtIds).flatMap { case (proposal, id) =>
      proposal.layout.map(l => DashboardLayoutItem(id, l.x, l.y, l.w, l.h))
    }
    def derived(bp: String): Vector[DashboardLayoutItem] =
      LayoutReflow.reflow(LayoutReflow.fromItems(lg), LgCols, LayoutBreakpointScaling.breakpointCols(bp))
    DashboardLayout(lg = lg, md = derived("md"), sm = derived("sm"), xs = derived("xs"))
  }
}
