import { useMemo } from "react";

import { defaultChartAppearance, defaultPanelAppearance } from "../../../../theme/appearance";
import { formatCapturePair } from "../../../panels/history/formatCaptureTime";
import { selectPointOverlay } from "../../../panels/history/chartOverlay";
import type { HistoryPoint } from "../../../panels/history/outputHistoryService";
import { ChartRenderer } from "../../../panels/ui/renderers/ChartRenderer";
import { toChartFieldTypes } from "../../../../utils/chartTimeAxis";
import type { Output } from "../../types/output";
import { readChartConfig } from "../outputEditor/outputConfigTypes";
import { relabelNullCategory } from "../../../../utils/blankLabel";

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
  // HEL-1424 -- a grouped series stores a null group as the category "null" (history cannot tell it
  // from the text "null", owner ruling), shown as "(blank)". The selected rows and the "vs" overlay
  // points are relabelled together so they stay aligned; rows-mode and time points are untouched.
  const grouped = series?.mode === "grouped";
  const rawRows = useMemo(
    () =>
      series
        ? series.points
            .filter((p) => p[1] !== null)
            .map((p) => {
              const x = String(p[0] ?? "");
              return [grouped ? relabelNullCategory(x) : x, String(p[1])];
            })
        : null,
    [series, grouped],
  );
  const overlay = useMemo(() => {
    if (!comparison) return null;
    const picked = selectPointOverlay(
      series,
      comparison.summary.series ?? null,
      `vs ${formatCapturePair(selected.capturedAt, comparison.capturedAt).comparison}`,
    );
    if (!picked || !grouped) return picked;
    return {
      ...picked,
      points: picked.points.map(([x, y]): [unknown, number | null] => [relabelNullCategory(x), y]),
    };
  }, [series, comparison, selected.capturedAt, grouped]);
  const fieldTypes = useMemo(() => toChartFieldTypes(output.schema), [output.schema]);
  const appearance = useMemo(
    () => ({
      ...defaultPanelAppearance,
      chart: { ...defaultChartAppearance, chartType: cfg.chartType },
    }),
    [cfg.chartType],
  );
  // HEL-1311 -- the stored summary is a 2-column series, which cannot draw a heatmap's matrix or a
  // histogram's bins; say so rather than draw a misleading bar/line.
  if (cfg.chartType === "heatmap" || cfg.chartType === "histogram") {
    return (
      <p className="output-history__muted">
        A history chart isn&apos;t drawn for heatmap or histogram Outputs.
      </p>
    );
  }
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
        fieldTypes={fieldTypes}
      />
    </div>
  );
}
