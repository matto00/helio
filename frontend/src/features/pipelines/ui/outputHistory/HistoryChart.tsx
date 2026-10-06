import { useMemo } from "react";

import { defaultChartAppearance, defaultPanelAppearance } from "../../../../theme/appearance";
import { formatCaptureTime, sameMinute } from "../../../panels/history/formatCaptureTime";
import { selectPointOverlay } from "../../../panels/history/chartOverlay";
import type { HistoryPoint } from "../../../panels/history/outputHistoryService";
import { ChartRenderer } from "../../../panels/ui/renderers/ChartRenderer";
import type { Output } from "../../types/output";
import { readChartConfig } from "../outputEditor/outputConfigTypes";

interface HistoryChartProps {
  output: Output;
  selected: HistoryPoint;
  comparison: HistoryPoint | null;
}

/** HEL-1277 design D5 — a chart Output's selected point drawn from its stored series (no payload
 *  needed) with the next-older point's series as the labelled "vs" overlay when the two describe the
 *  same plot. Series points with a null y are omitted from the primary (never coerced to 0). */
export function HistoryChart({ output, selected, comparison }: HistoryChartProps) {
  const series = selected.summary.series ?? null;
  const cfg = useMemo(() => readChartConfig(output.config), [output.config]);
  const rawRows = useMemo(
    () =>
      series
        ? series.points.filter((p) => p[1] !== null).map((p) => [String(p[0] ?? ""), String(p[1])])
        : null,
    [series],
  );
  const overlay = useMemo(
    () =>
      comparison
        ? selectPointOverlay(
            series,
            comparison.summary.series ?? null,
            `vs ${formatCaptureTime(comparison.capturedAt, sameMinute(selected.capturedAt, comparison.capturedAt))}`,
          )
        : null,
    [series, comparison, selected.capturedAt],
  );
  const appearance = useMemo(
    () => ({
      ...defaultPanelAppearance,
      chart: { ...defaultChartAppearance, chartType: cfg.chartType },
    }),
    [cfg.chartType],
  );
  if (!series || !rawRows || rawRows.length === 0) {
    return <p className="output-history__muted">No chart series was stored for this run.</p>;
  }
  return (
    <div className="output-history__chart" role="img" aria-label={`${series.y} by ${series.x}`}>
      <ChartRenderer
        appearance={appearance}
        rawRows={rawRows}
        headers={[series.x, series.y]}
        fieldMapping={{ xAxis: series.x, yAxis: series.y }}
        chartOptions={cfg.chartOptions}
        overlay={overlay}
      />
    </div>
  );
}
