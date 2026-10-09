import { compareLabel, configCompare } from "./metricHistoryView";
import { formatCaptureTime } from "./formatCaptureTime";
import type { HistorySeries, OutputHistory } from "./outputHistoryService";
import { isAggFn } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import type { AggFn } from "../types/panel";

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

/** HEL-1351 design D1 — the one notion of "this chart Output is aggregated", shared by the editor
 *  preview, the dashboard's client-side grouping, the overlay selector and the Compare blocker so
 *  they cannot drift. Mirrors the server's `OutputSummaryReducer.series` grouped-mode condition. */
export interface ChartAggregationSpec {
  groupBy: string;
  agg: AggFn;
  yField: string;
  /** HEL-1408 design D10a -- set only by `ChartOutputPanel` (never by `chartAggregationSpec`): the
   *  loaded records hold a strict-`null` group value, so a click on the `"null"` bar means "blank".
   *  Optional so the shared "is this aggregated" notion stays computable from config alone. */
  groupHasNull?: boolean;
}

export function chartAggregationSpec(config: Record<string, unknown>): ChartAggregationSpec | null {
  if (config.chartType === "scatter") return null;
  const agg = asRecord(config.aggregation);
  const { groupBy, yField } = agg;
  if (!nonEmptyString(groupBy) || !nonEmptyString(yField)) return null;
  if (typeof agg.agg !== "string" || !isAggFn(agg.agg)) return null;
  return { groupBy: groupBy as string, agg: agg.agg, yField: yField as string };
}

/** HEL-1350 design D5 / HEL-1351 D5 — what in an Output's OWN config rules the dashboard overlay
 *  out. A conservative superset of the runtime rules; bar-option blockers apply whatever the
 *  Output's chartType is. An aggregated Output (see `chartAggregationSpec`) overlays its grouped
 *  baseline, so it never blocks on aggregation, series or unmapped x/y. */
export type ChartCompareBlocker = "series" | "unmapped" | "horizontal" | "normalized";

function nonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v !== "";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function chartCompareBlocker(config: Record<string, unknown>): ChartCompareBlocker | null {
  const mapping = asRecord(config.fieldMapping);
  const bar = asRecord(asRecord(config.chartOptions).bar);
  if (chartAggregationSpec(config) === null) {
    if (nonEmptyString(mapping.series)) return "series";
    if (!nonEmptyString(mapping.xAxis) || !nonEmptyString(mapping.yAxis)) return "unmapped";
  }
  if (bar.orientation === "horizontal") return "horizontal";
  if (bar.stacking === "normalized") return "normalized";
  return null;
}

/** HEL-1277 design D9 — the dashboard chart overlay: the `config.compare` baseline's stored series,
 *  drawn only when it is exactly what the dashboard plots (raw rows with the same x/y, or the grouped aggregate with the same groupBy/yField/agg), the panel's rows are
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

  const spec = chartAggregationSpec(config);
  if (spec !== null) {
    // Aggregated Output: the dashboard plots one value per group, so only the server's grouped
    // series for the same groupBy/yField/agg describes it. Categories are unique by construction.
    // Known harmless gap: the server truncates category strings over `MaxXStringChars`, so such a
    // category simply gets no overlay point.
    if (series.mode !== "grouped") return null;
    if (series.x !== spec.groupBy || series.y !== spec.yField) return null;
    if ((series.agg ?? null) !== spec.agg) return null;
  } else {
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
  }

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
