// HEL-1517 — echarts-free helpers behind the two chart footnotes that need the row data: rows added
// together because they share an x (or instant) and a series, and scatter rows with no numeric x. The option
// builders and `ChartRenderer`'s footnotes both use `sumBySeriesAndKey` / these note functions, so the count a
// footnote states can never disagree with what the builder plotted (HEL-512: no echarts import here).

import { resolveDataColumns } from "./chartClickSelection";
import type { ChartPlan } from "./chartTimePlan";

/** A row and the key it shares with other rows of its series: its raw x (category axis) or its instant. */
export interface KeyedRow<K> {
  key: K;
  row: string[];
}

export interface SeriesSums<K> {
  /** series value -> key -> sum of the numeric y of every row with that series and key. */
  sums: Map<string, Map<K, number>>;
  /** Every numeric-y row in a cell holding two or more numeric-y rows. */
  summedRows: number;
}

/** Adds the numeric y of rows that share a series and key. A non-numeric y contributes nothing (a cell
 *  with no numeric y has no entry, so the builder leaves a gap). */
export function sumBySeriesAndKey<K>(
  entries: readonly KeyedRow<K>[],
  yCol: number,
  seriesCol: number,
): SeriesSums<K> {
  const sums = new Map<string, Map<K, number>>();
  const counts = new Map<string, Map<K, number>>();
  for (const { key, row } of entries) {
    const y = parseFloat(row[yCol] ?? "");
    if (Number.isNaN(y)) continue;
    const series = row[seriesCol] ?? "";
    const bySum = sums.get(series) ?? new Map<K, number>();
    const byCount = counts.get(series) ?? new Map<K, number>();
    bySum.set(key, (bySum.get(key) ?? 0) + y);
    byCount.set(key, (byCount.get(key) ?? 0) + 1);
    sums.set(series, bySum);
    counts.set(series, byCount);
  }
  let summedRows = 0;
  for (const byCount of counts.values()) {
    for (const n of byCount.values()) if (n >= 2) summedRows += n;
  }
  return { sums, summedRows };
}

/** The keyed rows `buildDataOptionCore`'s multi-series branch sums over: instants on a time axis, else the raw x. */
export function multiSeriesEntries(
  plan: Pick<ChartPlan, "timePlan">,
  rawRows: string[][],
  xCol: number,
): { time: boolean; entries: KeyedRow<string | number>[] } {
  if (plan.timePlan.kind === "time" && "timed" in plan.timePlan) {
    return { time: true, entries: plan.timePlan.timed.map(({ t, row }) => ({ key: t, row })) };
  }
  return { time: false, entries: rawRows.map((row) => ({ key: row[xCol] ?? "", row })) };
}

const NON_MULTI_SERIES = ["scatter", "pie", "heatmap", "histogram"];

/** "N rows with the same x value and series were added together." (time axis: "... same time and ..."); `null`
 *  when the chart is not a raw-row multi-series line/bar or no two numeric rows share an x and series. */
export function summedRowsNote(
  plan: ChartPlan,
  rawRows: string[][] | null | undefined,
  headers: string[] | null | undefined,
  fieldMapping: Record<string, string> | null | undefined,
): string | null {
  if (plan.source !== "rows" || !rawRows || !headers || NON_MULTI_SERIES.includes(plan.chartType)) {
    return null;
  }
  const { xCol, yCol, seriesCol } = resolveDataColumns(headers, fieldMapping);
  if (xCol === -1 || yCol === -1 || seriesCol === -1) return null;
  const { time, entries } = multiSeriesEntries(plan, rawRows, xCol);
  const { summedRows } = sumBySeriesAndKey(entries, yCol, seriesCol);
  if (summedRows < 2) return null;
  return `${summedRows} rows with the same ${time ? "time" : "x value"} and series were added together.`;
}

/** "N rows with no numeric x value not shown." — a non-time scatter draws no point for a row whose x is
 *  not numeric; `null` for any other chart or when none are left out. */
export function scatterOmittedNote(
  plan: ChartPlan,
  rawRows: string[][] | null | undefined,
  headers: string[] | null | undefined,
  fieldMapping: Record<string, string> | null | undefined,
): string | null {
  if (plan.source !== "rows" || plan.chartType !== "scatter" || plan.timePlan.kind === "time") {
    return null;
  }
  if (!rawRows || !headers) return null;
  const { xCol, yCol } = resolveDataColumns(headers, fieldMapping);
  if (xCol === -1 || yCol === -1) return null;
  const omitted = rawRows.filter((r) => Number.isNaN(parseFloat(r[xCol] ?? ""))).length;
  if (omitted === 0) return null;
  return `${omitted} ${omitted === 1 ? "row" : "rows"} with no numeric x value not shown.`;
}
