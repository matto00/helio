// Compact-chart sizes shared by `buildChartOption` and `valueAxisLabels` (a leaf module, so the two
// never import each other).

/** `compact` mode (HEL-301, phone stack + F-094/F-026 measured-small panels):
 *  axis-label font size, shrunk from ECharts' default to fit a narrow width
 *  (W5: "fix via ECharts config, not CSS" — this is an ECharts option value,
 *  not a CSS token). */
export const COMPACT_AXIS_LABEL_FONT_SIZE = 10;

/** F-028 — compact-mode grid inset (px). Paired with `containLabel: true` so
 *  ECharts reserves exactly the space the (now-shrunk) axis labels/names
 *  need instead of its own default percentage-based margins, which — on a
 *  ~140px-tall mobile chart canvas — consumed nearly the entire box and left
 *  the plotted series a near-invisible sliver. */
export const COMPACT_GRID_INSET_PX = 8;

/** The band the compact x-axis labels take under the plot: label line box plus the gap to the axis
 *  (measured at 17px with the 10px font; `containLabel` reserves it inside the canvas). */
export const COMPACT_X_LABEL_BAND_PX = 17;

/** Vertical room one compact axis label needs: its font's line box (1.2 x the size). */
export const COMPACT_LABEL_LINE_BOX_PX = Math.ceil(COMPACT_AXIS_LABEL_FONT_SIZE * 1.2);
