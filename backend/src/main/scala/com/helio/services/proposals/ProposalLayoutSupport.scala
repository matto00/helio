package com.helio.services.proposals

import com.helio.api.protocols.proposals.ProposalPanel
import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}
import com.helio.services.panels.{ItemSize, LayoutBreakpointScaling, LayoutPolicy, LayoutReflow, LayoutValidator, PlacementSizes}

/** Layout handling shared by `DashboardProposalService` (apply) and `DashboardContentsService`
 *  (replace contents) — HEL-1071. A proposal carries only an authored `lg` placement per panel
 *  (all-or-none is NOT required: a panel without one is appended below the authored ones, HEL-1260). The lg
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

  /** The full layout for the created panels `builtIds` (same order as `proposalPanels`). A panel with an
   *  authored `lg` placement keeps it; every other panel is appended below the authored ones at x = 0,
   *  in proposal order, at `lgSizes(i)` (its create-time size; [[PlacementSizes.ContentDefault]] when
   *  the caller has none), so no created panel is left without an item (HEL-1260). md/sm/xs are
   *  reflowed from the full `lg`. */
  def buildLayout(
      proposalPanels: Vector[ProposalPanel],
      builtIds: Vector[PanelId],
      lgSizes: Vector[ItemSize] = Vector.empty
  ): DashboardLayout = {
    val zipped = proposalPanels.zip(builtIds)
    val authored = zipped.flatMap { case (proposal, id) =>
      proposal.layout.map(l => DashboardLayoutItem(id, l.x, l.y, l.w, l.h))
    }
    val bottom = (authored.map(i => i.y + i.h) :+ 0).max
    val unauthored = zipped.zipWithIndex.collect { case ((proposal, id), idx) if proposal.layout.isEmpty => (id, idx) }
      .foldLeft((bottom, Vector.empty[DashboardLayoutItem])) { case ((y, acc), (id, idx)) =>
        val size = lgSizes.lift(idx).getOrElse(PlacementSizes.ContentDefault.lg)
        (y + size.h, acc :+ DashboardLayoutItem(id, 0, y, size.w, size.h))
      }._2
    val lg = authored ++ unauthored
    def derived(bp: String): Vector[DashboardLayoutItem] =
      LayoutReflow.reflow(LayoutReflow.fromItems(lg), LgCols, LayoutBreakpointScaling.breakpointCols(bp))
    DashboardLayout(lg = lg, md = derived("md"), sm = derived("sm"), xs = derived("xs"))
  }
}
