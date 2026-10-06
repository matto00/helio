import { useEffect, useMemo } from "react";

import type { MappedPanelData } from "../types/panel";
import type { FilteredMetric } from "../../pipelines/services/outputService";
import { readMetricConfig } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { computeAggregate } from "../../../utils/aggregate";
import { MetricRenderer, formatMetricValue } from "./renderers/MetricRenderer";
import { useOutputHistory, type HistorySource } from "../history/useOutputHistory";
import {
  configCompare,
  resolveServerMetricField,
  selectMetricHistoryView,
} from "../history/metricHistoryView";
import {
  comparisonStoreKey,
  publishComparison,
  unpublishComparison,
} from "../history/metricComparisonStore";

interface MetricOutputPanelProps {
  panelId: string;
  outputId: string;
  /** Absent on the public path (`PublicOutputMeta` carries none), where it is not needed. */
  pipelineId?: string;
  config: Record<string, unknown>;
  rawRows: string[][] | null | undefined;
  headers: string[] | null | undefined;
  /** An applied viewer control filter or cross-filter narrows this panel's rows (design D3). */
  filterActive: boolean;
  /** The metric over the FULL filtered set from the last page-0 rows response (HEL-1326 design D6);
   *  `undefined` = none provided, so the loaded-rows value stands. */
  filteredMetric?: FilteredMetric | null;
  historySource?: HistorySource;
}

/** HEL-1275 — the metric branch of `OutputPanelContent`: today's loaded-rows value, replaced by the
 *  server all-rows headline when the history read is valid for the current config (design D2), plus
 *  the delta/sparkline/available-from/filtered presentation and the provenance hand-off (D5). */
export function MetricOutputPanel({
  panelId,
  outputId,
  pipelineId,
  config,
  rawRows,
  headers,
  filterActive,
  filteredMetric,
  historySource,
}: MetricOutputPanelProps) {
  const cfg = readMetricConfig(config);
  const history = useOutputHistory(
    outputId,
    panelId,
    pipelineId,
    historySource,
    true,
    configCompare(config),
  );
  const view = useMemo(
    () => selectMetricHistoryView(history, config, filterActive),
    [history, config, filterActive],
  );

  const firstRow =
    rawRows && headers && rawRows.length > 0
      ? Object.fromEntries(headers.map((h, i) => [h, rawRows[0][i]]))
      : null;
  // The server's own selection rule (also reads `aggregation.value`, where the editor stores an
  // aggregated metric's field), so a filtered panel aggregates the same column the headline does.
  const resolvedMetric = resolveServerMetricField(config);
  const valueColumn = resolvedMetric?.field;
  const rowsAsRecords =
    rawRows && headers
      ? rawRows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])))
      : [];
  const loadedValue =
    valueColumn && cfg.aggregation?.agg
      ? String(computeAggregate(rowsAsRecords, valueColumn, cfg.aggregation.agg) ?? "")
      : valueColumn && firstRow
        ? String(firstRow[valueColumn] ?? "")
        : "";
  // HEL-1326 design D6 — under a server-applied filter the headline is the full-filtered-set value,
  // never the loaded page's aggregate; it only counts when it was computed from the field/agg the
  // CURRENT config resolves to (`metric: null` agrees with a config that resolves to no field).
  const filteredValue =
    filterActive && filteredMetric !== undefined
      ? filteredMetric === null
        ? resolvedMetric === null
          ? ""
          : null
        : resolvedMetric !== null &&
            filteredMetric.field === resolvedMetric.field &&
            filteredMetric.agg === resolvedMetric.agg
          ? filteredMetric.value === null
            ? ""
            : String(filteredMetric.value)
          : null
      : null;
  const value =
    filteredValue !== null
      ? filteredValue
      : view.headline !== null
        ? String(view.headline)
        : loadedValue;
  const data: MappedPanelData = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" };

  const comparison = view.comparison;
  const baselineAt = comparison?.kind === "delta" ? comparison.baselineAt : null;
  const baselineValue = comparison?.kind === "delta" ? comparison.baselineValue : null;
  const baselineText =
    baselineValue === null
      ? null
      : `${formatMetricValue(String(baselineValue), cfg.format) ?? ""}${cfg.unit ? ` ${cfg.unit}` : ""}`;
  const storeKey = comparisonStoreKey(historySource ? "public" : "authenticated", panelId);
  useEffect(() => {
    const publisher = Symbol(storeKey);
    publishComparison(
      storeKey,
      publisher,
      baselineAt !== null && baselineText !== null ? { baselineAt, baselineText } : null,
    );
    return () => unpublishComparison(storeKey, publisher);
  }, [storeKey, baselineAt, baselineText]);

  return (
    <MetricRenderer
      data={data}
      format={cfg.format}
      comparison={comparison}
      sparkline={view.sparkline}
    />
  );
}
