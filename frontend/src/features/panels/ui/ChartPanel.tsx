import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// F-022 — `/core` entry point + our own selectively-registered `echarts`
// instance (`echartsCore.ts`), instead of the default `echarts-for-react`
// export, which hard-imports the full, non-tree-shakeable `echarts` package
// (1.12 MB min / 369 KB gzip) and auto-registers every chart type/component
// it ships, defeating bundler tree-shaking regardless of what's actually
// used here (only the `ChartType` set registered in `echartsCore.ts`).
import ReactECharts from "echarts-for-react/esm/core";

import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import type { GroupedAggregate } from "../../../utils/aggregate";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
import { valueAxisSplitCap } from "./valueAxisLabels";
import {
  CHART_COMPACT_HEIGHT_PX,
  PIE_LEGEND_HIDE_HEIGHT_PX,
  useMeasuredChartHeight,
} from "./useChartCompact";
import type { ChartAggregationSpec, ChartOverlay } from "../history/chartOverlay";
import type { ReferenceMarks } from "../../../utils/referenceMarks";
import type { ChartFieldTypes } from "../../../utils/chartTimeAxis";
import { useChartOption } from "./useChartOption";
import { useChartClickHandler } from "./useChartClickHandler";
import { useHeatmapDefaultCursor } from "./useHeatmapDefaultCursor";
import { useChartEntranceMotion } from "./useChartEntranceMotion";
import { chartShapeSignature, ShapeMemory } from "./chartShapeSignature";
import { resolveChartType } from "../../../utils/chartAppearance";
import echarts from "./echartsCore";

export interface ChartPanelProps {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  /** HEL-292: precomputed groupBy aggregate. Only applied when the rendered
   *  `chartType` is `bar`/`line`/`pie` (HEL-624) — scatter (or an absent
   *  aggregate) falls back to the existing per-row `rawRows` path unchanged. */
  chartAggregate?: GroupedAggregate | null;
  /** HEL-1351 design D3 — the aggregation `chartAggregate` was grouped by. When set (and the
   *  rendered type is bar/line/pie) a click selects on its `groupBy` dimension. */
  aggregationSpec?: ChartAggregationSpec | null;
  /** HEL-248: persisted per-chart-type display options. The active chart type's
   *  entry is applied to the built option; entries for other types are ignored
   *  on render but preserved in storage. */
  chartOptions?: ChartTypeOptionsMap | null;
  /** HEL-1277: a labelled "vs" comparison series (see `buildChartOption`'s `overlay`). */
  overlay?: ChartOverlay | null;
  /** HEL-1306: static reference lines/bands on the value axis (see `applyReferenceMarks`). */
  referenceMarks?: ReferenceMarks | null;
  /** HEL-1305: field name -> declared schema type; a `timestamp` x field plots on a time axis. */
  fieldTypes?: ChartFieldTypes | null;
  /** HEL-301: true when rendered in the phone stack, where there is no room
   *  for a legend and full-size axis labels overflow. Hides the legend and
   *  shrinks axis label font via ECharts config — "fix via ECharts config,
   *  not CSS" per the binding handoff — rather than clipping with `overflow:
   *  hidden`. Defaults to false; ORed with the chart's own measured size
   *  (F-094/F-026 — see `useMeasuredChartHeight`), so a short *desktop*
   *  chart gets the same treatment without needing this prop threaded to it. */
  compact?: boolean;
  /** HEL-572 design.md D2 — invoked with the click-resolved selection
   *  (design.md D3) whenever the user clicks a genuine chart series element
   *  (a bar, line point, pie slice, or scatter point) — never the legend,
   *  an axis, or empty grid area. `ChartPanel` stays free of Redux
   *  (consistent with its existing presentational-component shape); the
   *  caller (`PanelCard`/`PanelFullscreenOverlay`) owns dispatching
   *  `selectDataPoint`. Omitted entirely for a non-chart-eligible mount —
   *  see `ChartInspectConfig`. */
  onDataPointSelect?: (selection: ChartClickSelection) => void;
  /** HEL-1632: draw every option (the first one included) with no animation. The pipeline page's live Output re-draws on each
   *  draft edit, and a data-change morph would paint frames between one edit and the next. */
  noAnimation?: boolean;
}

export function ChartPanel({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  aggregationSpec,
  chartOptions,
  overlay,
  referenceMarks,
  fieldTypes,
  compact = false,
  onDataPointSelect,
  noAnimation = false,
}: ChartPanelProps = {}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const measuredHeight = useMeasuredChartHeight(wrapperRef);
  const measuredCompact = measuredHeight > 0 && measuredHeight <= CHART_COMPACT_HEIGHT_PX;
  const effectiveCompact = compact || measuredCompact;
  const measuredPieLegendOverlap =
    measuredHeight > 0 && measuredHeight <= PIE_LEGEND_HIDE_HEIGHT_PX;

  const builtOption = useChartOption({
    appearance,
    rawRows,
    headers,
    fieldMapping,
    chartAggregate,
    chartOptions,
    overlay,
    referenceMarks,
    fieldTypes,
    effectiveCompact,
    valueAxisSplitCap: valueAxisSplitCap(measuredHeight),
    measuredPieLegendOverlap,
  });

  const { onEvents: chartOnEvents } = useChartClickHandler({
    appearance,
    rawRows,
    headers,
    fieldMapping,
    chartOptions,
    aggregationSpec: chartAggregate ? aggregationSpec : null,
    onDataPointSelect,
  });

  // HEL-1311 -- a heatmap cell is not clickable, so the canvas must not show a pointer over it.
  const onHeatmapReady = useHeatmapDefaultCursor(resolveChartType(appearance?.chart) === "heatmap");

  // HEL-1034 / HEL-1573 -- token-timed entrance that plays once per chart mount and is not replayed by option changes.
  const { option: motionOption, onChartReady: onEntranceReady } =
    useChartEntranceMotion(builtOption);
  const option = useMemo(
    () =>
      noAnimation
        ? { ...motionOption, animation: false, animationDurationUpdate: 0 }
        : motionOption,
    [noAnimation, motionOption],
  );
  const onChartReady = useCallback(
    (chart: Parameters<typeof onHeatmapReady>[0] & Parameters<typeof onEntranceReady>[0]) => {
      onHeatmapReady(chart);
      onEntranceReady(chart);
    },
    [onHeatmapReady, onEntranceReady],
  );

  // HEL-1584 D10 -- a refresh that changes only the data (same signature as what was last committed) updates the existing
  // series in place, so ECharts animates the change; any other change replaces the chart outright. The first render has
  // nothing committed, so it always replaces. The signature is of the option BEFORE the entrance's animation settings, which
  // change once the entrance window closes and are not a shape change.
  const signature = useMemo(() => chartShapeSignature(builtOption), [builtOption]);
  const [memory] = useState(() => new ShapeMemory());
  const sameShape = memory.matches(signature);
  useEffect(() => {
    memory.commit(signature);
  }, [memory, signature]);

  return (
    <div ref={wrapperRef} style={{ height: "100%", width: "100%" }}>
      <ReactECharts
        onChartReady={onChartReady}
        echarts={echarts}
        option={option}
        onEvents={chartOnEvents}
        // Replaces unless only the data changed (see `sameShape` above). Switching `chartType` between cartesian
        // (bar/line/scatter) and pie, or removing any option, needs ECharts to fully replace its internal series/axis
        // state, not merge onto it -- a stale `xAxis` or `series` shape left over from the previous chart type is
        // exactly the kind of invalid-option crash F-027 fixes elsewhere. A same-shape refresh merges, with the series
        // replaced by id, so it morphs instead of redrawing. The real fix for F-231's other complaint (rebuilding the
        // option object itself) is the `useMemo` inside `useChartOption`.
        notMerge={!sameShape}
        replaceMerge={sameShape ? ["series"] : undefined}
        autoResize={true}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
