import { useCallback, useMemo } from "react";

import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import { resolveChartType } from "../../../utils/chartAppearance";
// HEL-572 — kept as a SEPARATE, echarts-import-free module (see its own
// header comment) so `PanelCard.tsx`/`PanelFullscreenOverlay.tsx` can reuse
// the row-filter half without pulling this file's lazy-loaded echarts chunk
// into the main bundle (HEL-512).
import { mapChartClickToSelection } from "../../../utils/chartClickSelection";
import type { ChartClickParams, ChartClickSelection } from "../../../utils/chartClickSelection";

/** The slice of ECharts' own click-callback `params` shape this component's
 *  handler reads: `ChartClickParams` (chartClickSelection.ts's module-
 *  boundary-safe subset) plus the nested native-event handle design.md D2
 *  calls `stopPropagation` on. Declared here (not in that echarts-import-
 *  free module) since only this hook's `onEvents` handler ever sees the raw
 *  ECharts event shape. */
export interface EChartsClickEventParams extends ChartClickParams {
  event?: { event?: { stopPropagation?: () => void } };
}

export interface UseChartClickHandlerParams {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  chartOptions?: ChartTypeOptionsMap | null;
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

/** Owns the HEL-572 click-event wiring: `handleChartClick` and the
 *  `chartOnEvents` memo handed to `ReactECharts`'s `onEvents` prop
 *  (design.md D4 — a direct, mechanical move of `ChartPanel`'s own former
 *  hook sequence, called from the exact position those hooks used to
 *  occupy). */
export function useChartClickHandler({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartOptions,
  onDataPointSelect,
}: UseChartClickHandlerParams): { onEvents: { click: (params: EChartsClickEventParams) => void } } {
  // HEL-572 design.md D2 — bails out (does nothing) unless the click landed
  // on a genuine series element, so a legend or empty-grid-area click still
  // falls through unmodified to the existing panel-body-click "open
  // Customize" handler on `article onClick` (DesktopPanelGrid.tsx). For a
  // genuine series click, `stopPropagation` runs BEFORE anything else —
  // including before resolving whether a mapping is even possible — so the
  // click never reaches that handler regardless of mapping outcome. This is
  // the one call site translating ECharts' own click-event shape into the
  // module-boundary-safe `ChartClickParams` (chartClickSelection.ts) — see
  // that module's header comment for why the mapping/filtering logic itself
  // never imports `echarts`.
  const handleChartClick = useCallback(
    (params: EChartsClickEventParams) => {
      if (params.componentType !== "series") return;
      params.event?.event?.stopPropagation?.();
      if (!onDataPointSelect || !rawRows || !headers || headers.length === 0) return;
      const chartType = resolveChartType(appearance?.chart);
      const selection = mapChartClickToSelection(
        params,
        chartType,
        fieldMapping,
        headers,
        rawRows,
        chartOptions?.scatter,
      );
      if (selection) onDataPointSelect(selection);
    },
    [onDataPointSelect, rawRows, headers, fieldMapping, chartOptions, appearance],
  );

  const chartOnEvents = useMemo(() => ({ click: handleChartClick }), [handleChartClick]);

  return { onEvents: chartOnEvents };
}
