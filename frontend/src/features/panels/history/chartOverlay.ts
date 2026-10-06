import { compareLabel, configCompare } from "./metricHistoryView";
import { formatCaptureTime } from "./formatCaptureTime";
import type { HistorySeries, OutputHistory } from "./outputHistoryService";

/** HEL-1277 — a labelled "vs" series handed to `buildChartOption`: x/y points of a comparison. */
export interface ChartOverlay {
  label: string;
  points: [unknown, number | null][];
}

function hasRepeatedX(xs: unknown[]): boolean {
  const seen = new Set<string>();
  for (const x of xs) {
    const k = String(x);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

export interface ChartOverlayContext {
  /** A viewer control filter or cross-filter is narrowing the panel's rows. */
  filterActive: boolean;
  /** Whether more rows exist than the panel loaded. `undefined` (unknown) fails closed. */
  rowsTruncated: boolean | undefined;
  /** The panel's loaded rows/headers — a repeated primary x makes first-match alignment ambiguous. */
  rawRows: string[][] | null | undefined;
  headers: string[] | null | undefined;
}

/** HEL-1277 design D9 — the dashboard chart overlay: the `config.compare` baseline's stored series,
 *  drawn only when it is exactly what the dashboard plots (raw rows, same x/y), the panel's rows are
 *  known to be the Output's complete set, and nothing narrows them. Every omission returns `null`. */
export function selectChartOverlay(
  history: OutputHistory | null,
  config: Record<string, unknown>,
  ctx: ChartOverlayContext,
): ChartOverlay | null {
  const compare = configCompare(config);
  if (compare === null || !history || (history.compare ?? null) !== compare) return null;
  if (ctx.filterActive || ctx.rowsTruncated !== false) return null;
  const baseline = history.baseline;
  const series = baseline?.series;
  if (!baseline || !series || series.downsampled) return null;

  const mapping =
    config.fieldMapping !== null && typeof config.fieldMapping === "object"
      ? (config.fieldMapping as Record<string, unknown>)
      : {};
  const xField = typeof mapping.xAxis === "string" ? mapping.xAxis : null;
  const yField = typeof mapping.yAxis === "string" ? mapping.yAxis : null;
  if (series.mode !== "rows" || xField === null || yField === null) return null;
  if (series.x !== xField || series.y !== yField) return null;
  if (hasRepeatedX(series.points.map((p) => p[0]))) return null;

  const xCol = ctx.headers ? ctx.headers.indexOf(xField) : -1;
  if (xCol === -1 || !ctx.rawRows) return null;
  if (hasRepeatedX(ctx.rawRows.map((r) => r[xCol] ?? ""))) return null;

  const base = compareLabel(compare);
  const label = base === "custom" ? `vs ${formatCaptureTime(baseline.capturedAt)}` : `vs ${base}`;
  return { label, points: series.points };
}

/** HEL-1277 design D5 — the History view's overlay: the comparison point's series against the
 *  selected point's, only when both describe the same plot (`mode`/`x`/`y`/`agg`) and, in `rows`
 *  mode, neither repeats an x. A downsampled series is allowed (both sides share the server cap). */
export function selectPointOverlay(
  selected: HistorySeries | null | undefined,
  comparison: HistorySeries | null | undefined,
  label: string,
): ChartOverlay | null {
  if (!selected || !comparison) return null;
  if (
    selected.mode !== comparison.mode ||
    selected.x !== comparison.x ||
    selected.y !== comparison.y ||
    (selected.agg ?? null) !== (comparison.agg ?? null)
  ) {
    return null;
  }
  if (
    selected.mode === "rows" &&
    (hasRepeatedX(selected.points.map((p) => p[0])) ||
      hasRepeatedX(comparison.points.map((p) => p[0])))
  ) {
    return null;
  }
  return { label, points: comparison.points };
}
