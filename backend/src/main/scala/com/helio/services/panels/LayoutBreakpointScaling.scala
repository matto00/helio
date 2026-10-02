package com.helio.services.panels

/** The single Scala source of the responsive breakpoints' column counts.
 *
 *  Must mirror the frontend's `dashboardGridCols` (`frontend/src/features/dashboards/state/
 *  dashboardLayout.ts`) exactly, or the two sides disagree about how wide a "full width" item is and
 *  what in-bounds means. `LayoutValidatorSpec` asserts it equals the shared fixture
 *  (`shared-test-fixtures/layout-validity.json`) the frontend also asserts against.
 *
 *  HEL-1071: the proportional x/w scaling helpers that used to live here were removed — scaling a
 *  12-column placement into 2 columns keeps `y` and collapses distinct columns into the same cell.
 *  Narrower breakpoints are now derived by [[LayoutReflow]] (valid by construction). */
object LayoutBreakpointScaling {

  val breakpointCols: Map[String, Int] = Map("lg" -> 12, "md" -> 10, "sm" -> 6, "xs" -> 2)
}
