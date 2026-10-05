package com.helio.services.dashboards

import com.helio.domain.model.{DashboardLayout, DashboardLayoutItem, PanelId}
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutPolicy, LayoutValidator}

/** Pure decision logic for the owner-only stored-layout repair (HEL-1233).
 *
 *  A supplied breakpoint is acted on only when the stored one is stored-bad (as stored,
 *  including entries for deleted panels); a good stored breakpoint is never overwritten. Each
 *  accepted replacement must be valid, hold each panel at most once, reference only panels of
 *  the dashboard and keep every live panel the stored breakpoint held, so a stale or truncated
 *  client panel list can never make the server drop a panel. */
object DashboardLayoutRepair {

  def isStoredBad(items: Vector[DashboardLayoutItem], bp: String): Boolean =
    !LayoutValidator.isValid(items.map(LayoutValidator.toRect), LayoutBreakpointScaling.breakpointCols(bp))

  /** The breakpoints to write, or `Left(400 message)` naming the first offending breakpoint. */
  def plan(
      stored: DashboardLayout,
      patch: LayoutPolicy.Patch,
      panelIds: Set[PanelId]
  ): Either[String, LayoutPolicy.Patch] = {
    val candidates = LayoutPolicy.Breakpoints.flatMap { bp =>
      patch.get(bp).filter(_ => isStoredBad(LayoutPolicy.stored(stored, bp), bp)).map(bp -> _)
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
    if (vs.nonEmpty) Left(s"Layout repair rejected: breakpoint '$bp': ${vs.map(LayoutValidator.describe).mkString("; ")}")
    else if (ids.distinct.size != ids.size) Left(s"Layout repair rejected: breakpoint '$bp' lists a panel more than once")
    else if (unknown.nonEmpty) Left(s"Layout repair rejected: breakpoint '$bp' references unknown panels ${unknown.map(_.value).mkString(", ")}")
    else if (dropped.nonEmpty) Left(s"Layout repair rejected: breakpoint '$bp' would drop panels ${dropped.map(_.value).mkString(", ")}")
    else Right(())
  }
}
