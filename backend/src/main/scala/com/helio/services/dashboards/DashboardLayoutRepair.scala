package com.helio.services.dashboards

import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutPolicy, LayoutValidator}

/** Pure decision logic for the owner-only stored-layout repair (HEL-1233, widened by HEL-1260).
 *
 *  A breakpoint is repairable when the stored one is stored-bad (as stored, including entries for
 *  deleted panels) or incomplete (valid, but missing an item for a live panel; an empty breakpoint on
 *  a dashboard with live panels is incomplete). A supplied breakpoint is acted on only when its stored
 *  counterpart is repairable; a complete valid stored breakpoint is never overwritten. Each accepted
 *  replacement must be valid, hold each panel at most once, reference only panels of the dashboard
 *  and keep every live panel the stored breakpoint held, so a stale or truncated client panel list
 *  can never make the server drop a panel.
 *
 *  Precedence: stored-bad wins. Fixing an overlap must move items, so a breakpoint that is both
 *  stored-bad and missing a panel gets only the stored-bad checks. An incomplete-only breakpoint is
 *  additionally append-only: every live panel's stored item (its FIRST stored entry, matching the
 *  client's `liveEntries`) must come back unchanged; entries for deleted panels may be dropped.
 *  Owner ruling `extend-owner-repair` (HEL-1260) reversed the earlier "missing panels are never
 *  written by the repair". */
object DashboardLayoutRepair {

  def isStoredBad(items: Vector[DashboardLayoutItem], bp: String): Boolean =
    !LayoutValidator.isValid(items.map(LayoutValidator.toRect), LayoutBreakpointScaling.breakpointCols(bp))

  /** Valid as stored but lacking an item for at least one live panel. */
  def isIncomplete(items: Vector[DashboardLayoutItem], bp: String, panelIds: Set[PanelId]): Boolean =
    !isStoredBad(items, bp) && panelIds.exists(id => !items.exists(_.panelId == id))

  /** The breakpoints to write, or `Left(400 message)` naming the first offending breakpoint. */
  def plan(
      stored: DashboardLayout,
      patch: LayoutPolicy.Patch,
      panelIds: Set[PanelId]
  ): Either[String, LayoutPolicy.Patch] = {
    val candidates = LayoutPolicy.Breakpoints.flatMap { bp =>
      val items = LayoutPolicy.stored(stored, bp)
      patch.get(bp).filter(_ => isStoredBad(items, bp) || isIncomplete(items, bp, panelIds)).map(bp -> _)
    }
    val checked = candidates.foldLeft[Either[String, Vector[(String, Vector[DashboardLayoutItem])]]](Right(Vector.empty)) {
      case (Left(e), _)            => Left(e)
      case (Right(acc), (bp, items)) => check(bp, LayoutPolicy.stored(stored, bp), items, panelIds).map(_ => acc :+ (bp -> items))
    }
    checked.map { ok =>
      val m = ok.toMap
      LayoutPolicy.Patch(m.get("lg"), m.get("md"), m.get("sm"), m.get("xs"))
    }
  }

  private def check(
      bp: String,
      stored: Vector[DashboardLayoutItem],
      items: Vector[DashboardLayoutItem],
      panelIds: Set[PanelId]
  ): Either[String, Unit] = {
    val cols = LayoutBreakpointScaling.breakpointCols(bp)
    val vs   = LayoutValidator.violations(items.map(LayoutValidator.toRect), cols)
    val ids  = items.map(_.panelId)
    lazy val unknown = ids.filterNot(panelIds.contains).distinct
    lazy val dropped = stored.map(_.panelId).filter(panelIds.contains).filterNot(ids.toSet.contains).distinct
    lazy val moved = if (isStoredBad(stored, bp)) Vector.empty else storedLiveItems(stored, panelIds).filterNot(items.contains)
    if (vs.nonEmpty) Left(s"Layout repair rejected: breakpoint '$bp': ${vs.map(LayoutValidator.describe).mkString("; ")}")
    else if (ids.distinct.size != ids.size) Left(s"Layout repair rejected: breakpoint '$bp' lists a panel more than once")
    else if (unknown.nonEmpty) Left(s"Layout repair rejected: breakpoint '$bp' references unknown panels ${unknown.map(_.value).mkString(", ")}")
    else if (dropped.nonEmpty) Left(s"Layout repair rejected: breakpoint '$bp' would drop panels ${dropped.map(_.value).mkString(", ")}")
    else if (moved.nonEmpty) Left(s"Layout repair rejected: breakpoint '$bp' would move stored panels ${moved.map(_.panelId.value).mkString(", ")}")
    else Right(())
  }

  /** The first stored entry of each live panel, in stored order. */
  private def storedLiveItems(stored: Vector[DashboardLayoutItem], panelIds: Set[PanelId]): Vector[DashboardLayoutItem] =
    stored.filter(i => panelIds.contains(i.panelId)).groupBy(_.panelId).values.map(_.head).toVector
}
