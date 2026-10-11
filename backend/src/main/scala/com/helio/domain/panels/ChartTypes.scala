package com.helio.domain.panels

/** The single backend source of the chart-type set (HEL-1311): every write path, error string, tool
 *  schema and reducer that enumerates chart types reads it, and a seam spec pins it to the frontend
 *  `CHART_TYPES`, the MCP const and every schemas-directory chartType enum. */
object ChartTypes {

  /** Every accepted `chartType` value, in display order. */
  val All: Vector[String] = Vector("bar", "line", "pie", "scatter", "heatmap", "histogram")

  /** Chart types that never carry an `aggregation` (a non-null one is rejected on write). */
  val NonAggregating: Set[String] = Set("scatter", "heatmap", "histogram")

  val AllSet: Set[String] = All.toSet

  /** "bar, line, pie, ..." for error messages and prose. */
  val AllList: String = All.mkString(", ")
}
