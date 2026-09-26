import { useRef } from "react";
// F-022 — `/core` entry point + our own selectively-registered `echarts`
// instance (`echartsCore.ts`), instead of the default `echarts-for-react`
// export, which hard-imports the full, non-tree-shakeable `echarts` package
// (1.12 MB min / 369 KB gzip) and auto-registers every chart type/component
// it ships, defeating bundler tree-shaking regardless of what's actually
// used here (bar/line/pie/scatter only — see `ChartType`).
import ReactECharts from "echarts-for-react/esm/core";

import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import type { GroupedAggregate } from "../../../utils/aggregate";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
import {
  CHART_COMPACT_HEIGHT_PX,
  PIE_LEGEND_HIDE_HEIGHT_PX,
  useMeasuredChartHeight,
} from "./useChartCompact";
import { useChartOption } from "./useChartOption";
import { useChartClickHandler } from "./useChartClickHandler";
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
  /** HEL-248: persisted per-chart-type display options. The active chart type's
   *  entry is applied to the built option; entries for other types are ignored
   *  on render but preserved in storage. */
  chartOptions?: ChartTypeOptionsMap | null;
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
}

export function ChartPanel({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  chartOptions,
  compact = false,
  onDataPointSelect,
}: ChartPanelProps = {}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const measuredHeight = useMeasuredChartHeight(wrapperRef);
  const measuredCompact = measuredHeight > 0 && measuredHeight <= CHART_COMPACT_HEIGHT_PX;
  const effectiveCompact = compact || measuredCompact;
  const measuredPieLegendOverlap =
    measuredHeight > 0 && measuredHeight <= PIE_LEGEND_HIDE_HEIGHT_PX;

  const option = useChartOption({
    appearance,
    rawRows,
    headers,
    fieldMapping,
    chartAggregate,
    chartOptions,
    effectiveCompact,
    measuredPieLegendOverlap,
  });

  const { onEvents: chartOnEvents } = useChartClickHandler({
    appearance,
    rawRows,
    headers,
    fieldMapping,
    chartOptions,
    onDataPointSelect,
  });

  return (
    <div ref={wrapperRef} style={{ height: "100%", width: "100%" }}>
      <ReactECharts
        echarts={echarts}
        option={option}
        onEvents={chartOnEvents}
        // Kept `true`: switching `chartType` between cartesian (bar/line/
        // scatter) and pie needs ECharts to fully replace its internal
        // series/axis state, not merge onto it — a stale `xAxis` or `series`
        // shape left over from the previous chart type is exactly the kind
        // of invalid-option crash F-027 fixes elsewhere. The real fix for
        // F-231's other complaint (rebuilding the option object itself) is
        // the `useMemo` inside `useChartOption`.
        notMerge={true}
        autoResize={true}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
