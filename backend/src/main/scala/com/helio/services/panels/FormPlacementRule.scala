package com.helio.services.panels

import com.helio.domain.model.{DashboardLayoutItem, Panel}
import com.helio.domain.panels.{FormPanel, FormPanelConfig}

/** The 5-row form minimum (HEL-1618 client rule, HEL-1834 backend paths that copy a height).
 *
 *  A `form` panel that is not a compact counter is held to [[FormMinRows]]; a compact counter and every
 *  other kind has no floor. Twin of the client's `panelMinRows` / `isSpaceBelowFree` in
 *  `panelGridConfig.ts`: the same half-open interval arithmetic, so the two sides agree on when a lift is
 *  allowed. */
object FormPlacementRule {

  val FormMinRows: Int = 5

  /** The minimum rows `panel` may be placed at: [[FormMinRows]] for a non-counter form, else 1 (no floor). */
  def minRowsFor(panel: Panel): Int = panel match {
    case f: FormPanel if !FormPanelConfig.isCompactCounter(f.config) => FormMinRows
    case _                                                           => 1
  }

  /** True when no item other than `target` overlaps `target`'s columns `[x, x + w)` on rows
   *  `[y + h, y + rows)`: growing `target` to `rows` rows then moves nothing and overlaps nothing. */
  def isSpaceBelowFree(items: Vector[DashboardLayoutItem], target: DashboardLayoutItem, rows: Int): Boolean = {
    val top    = target.y + target.h
    val bottom = target.y + rows
    !items.exists { o =>
      o.panelId != target.panelId &&
      o.x < target.x + target.w && o.x + o.w > target.x &&
      o.y < bottom && o.y + o.h > top
    }
  }
}
