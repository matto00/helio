import { useMemo } from "react";

import type { PanelAppearance } from "../types/panel";
import { readChartConfig } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import type { GroupedAggregate } from "../../../utils/aggregate";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
import { selectChartOverlay } from "../history/chartOverlay";
import { configCompare } from "../history/metricHistoryView";
import { useOutputHistory, type HistorySource } from "../history/useOutputHistory";
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
  chartAggregate?: GroupedAggregate | null;
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
  chartAggregate,
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
  const overlay = useMemo(
    () => selectChartOverlay(history, config, { filterActive, rowsTruncated, rawRows, headers }),
    [history, config, filterActive, rowsTruncated, rawRows, headers],
  );
  return (
    <ChartRenderer
      appearance={appearance}
      rawRows={rawRows}
      headers={headers}
      fieldMapping={cfg.fieldMapping}
      chartAggregate={chartAggregate}
      chartOptions={cfg.chartOptions}
      annotation={cfg.annotation ?? null}
      overlay={overlay}
      compact={compact}
      onDataPointSelect={onDataPointSelect}
    />
  );
}
