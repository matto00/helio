import { useMemo } from "react";

import type { PanelAppearance } from "../types/panel";
import { readChartConfig } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { groupAndAggregate } from "../../../utils/aggregate";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
import { aggregateSeriesName } from "../../../utils/chartClickSelection";
import { defaultChartAppearance } from "../../../theme/appearance";
import { chartAggregationSpec, selectChartOverlay } from "../history/chartOverlay";
import { configCompare } from "../history/metricHistoryView";
import { useOutputHistory, type HistorySource } from "../history/useOutputHistory";
import { resolvePanelChartType } from "./resolvePanelChartType";
import { ChartRenderer } from "./renderers/ChartRenderer";

interface ChartOutputPanelProps {
  panelId: string;
  outputId: string;
  /** Absent on the public path (`PublicOutputMeta` carries none). */
  pipelineId?: string;
  config: Record<string, unknown>;
  appearance: PanelAppearance;
  rawRows: string[][] | null | undefined;
  headers: string[] | null | undefined;
  /** HEL-1351 design D2 — the loaded row RECORDS (cross-filter-narrowed like `rawRows`). An
   *  aggregated Output is grouped from these, not from the null-to-"" stringified `rawRows`, so a
   *  missing group key is `"null"` exactly as in the editor preview and the stored summary series. */
  records?: Record<string, unknown>[] | null;
  compact?: boolean;
  onDataPointSelect?: (selection: ChartClickSelection) => void;
  /** A viewer control filter or cross-filter narrows this panel's rows. */
  filterActive: boolean;
  /** Whether more rows exist than the panel loaded; `undefined` fails closed (no overlay). */
  rowsTruncated: boolean | undefined;
  historySource?: HistorySource;
}

/** HEL-1277 design D9 — the chart branch of `OutputPanelContent`: reads the Output's history (only
 *  when `config.compare` is set; the same cache entry a metric panel would share) and hands
 *  `ChartRenderer` the labelled "vs" overlay when it is valid for what this panel plots. A separate
 *  component, rendered after the parent's loading early-return, so the hook never runs inline. */
export function ChartOutputPanel({
  panelId,
  outputId,
  pipelineId,
  config,
  appearance,
  rawRows,
  headers,
  records,
  compact,
  onDataPointSelect,
  filterActive,
  rowsTruncated,
  historySource,
}: ChartOutputPanelProps) {
  const cfg = readChartConfig(config);
  const compare = configCompare(config);
  const history = useOutputHistory(
    outputId,
    panelId,
    pipelineId,
    historySource,
    compare !== null,
    compare,
  );
  // HEL-1351 design D7 — the panel's stored type, else the Output's, else line; one resolver for
  // render, click mapping and Inspect.
  const chartType = resolvePanelChartType(appearance.chart, config);
  const resolvedAppearance = useMemo<PanelAppearance>(
    () =>
      // Only a type the renderers would not already default to needs injecting (an absent type
      // renders `line`); a stored type wins and is passed through untouched.
      appearance.chart?.chartType || chartType === "line"
        ? appearance
        : { ...appearance, chart: { ...(appearance.chart ?? defaultChartAppearance), chartType } },
    [appearance, chartType],
  );
  // HEL-1351 design D1/D2 (C2) — an aggregated Output plots one value per group, grouped client-side
  // with the SAME function and condition the editor preview uses. A panel whose resolved type is
  // scatter renders raw rows (scatter never aggregates), so it neither groups nor re-keys clicks.
  const aggregationSpec = useMemo(
    () => (chartType === "scatter" ? null : chartAggregationSpec(config)),
    [chartType, config],
  );
  const chartAggregate = useMemo(
    () =>
      aggregationSpec && records
        ? {
            ...groupAndAggregate(
              records,
              aggregationSpec.groupBy,
              aggregationSpec.agg,
              aggregationSpec.yField,
            ),
            seriesName: aggregateSeriesName(aggregationSpec),
          }
        : null,
    [aggregationSpec, records],
  );
  // An aggregated Output only overlays its grouped baseline over the grouped plot; with no record
  // rows to group from, the panel falls back to raw rows and must not draw the grouped overlay.
  const groupedPlot = aggregationSpec === null || chartAggregate !== null;
  const overlay = useMemo(
    () =>
      groupedPlot
        ? selectChartOverlay(history, config, { filterActive, rowsTruncated, rawRows, headers })
        : null,
    [groupedPlot, history, config, filterActive, rowsTruncated, rawRows, headers],
  );
  return (
    <ChartRenderer
      appearance={resolvedAppearance}
      rawRows={rawRows}
      headers={headers}
      fieldMapping={cfg.fieldMapping}
      chartAggregate={chartAggregate}
      aggregationSpec={aggregationSpec}
      chartOptions={cfg.chartOptions}
      annotation={cfg.annotation ?? null}
      overlay={overlay}
      compact={compact}
      onDataPointSelect={onDataPointSelect}
    />
  );
}
