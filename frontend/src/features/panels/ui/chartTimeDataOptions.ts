// HEL-1305 — the time-axis half of `buildDataOptionCore` / `buildAggregateDataOption`. A timestamp x
// field plots every point as `{name: <raw x>, value: [epochMillis, y]}` on `xAxis: {type: "time"}`:
// `name` keeps the row's raw x so click filtering (`params.name`) matches rows literally.

import type { EChartsOption } from "echarts";

import type { ScatterChartOptions } from "../types/panel";
import type { ChartType } from "../../../utils/chartAppearance";
import type { GroupedAggregate } from "../../../utils/aggregate";
import { makeScatterSymbolSize } from "../../../utils/chartTypeOptions";
import type { AggregatePoint, TimedRow } from "../../../utils/chartTimePlan";

const TIME_X_AXIS = { type: "time" } as const;

const numberOr0 = (n: number) => (Number.isNaN(n) ? 0 : n);

/** A non-numeric y is no value (`null`), never a real 0 (HEL-1508). */
const numberOrNull = (raw: string | undefined): number | null => {
  const n = parseFloat(raw ?? "");
  return Number.isNaN(n) ? null : n;
};

/** Single series: one value per plotted row; a non-numeric y is a gap. */
export function buildTimeSingleSeries(
  timed: readonly TimedRow[],
  headers: string[],
  xCol: number,
  yCol: number,
  chartType: ChartType,
): Partial<EChartsOption> {
  const data = timed.map(({ t, row }) => ({
    name: row[xCol] ?? "",
    value: [t, numberOrNull(row[yCol])],
  }));
  return {
    xAxis: TIME_X_AXIS,
    legend: { data: [headers[yCol]] },
    series: [{ type: chartType, name: headers[yCol], data }],
  } as Partial<EChartsOption>;
}

/** Multi-series: one shared, sorted list of distinct instants for every series; a series with no
 *  numeric value at an instant gets `null` (a gap), never 0 (owner ruling 2). The lookup is keyed by
 *  instant so two spellings of one instant never produce a false gap; the point `name` is the
 *  first-seen raw spelling. */
export function buildTimeMultiSeries(
  rawRows: string[][],
  timed: readonly TimedRow[],
  xCol: number,
  yCol: number,
  seriesCol: number,
  chartType: ChartType,
): Partial<EChartsOption> {
  const nameByInstant = new Map<number, string>();
  for (const { t, row } of timed) {
    if (!nameByInstant.has(t)) nameByInstant.set(t, row[xCol] ?? "");
  }
  const groups = [...new Set(rawRows.map((r) => r[seriesCol] ?? ""))];
  const lookup = new Map<string, Map<number, number>>();
  for (const { t, row } of timed) {
    const y = parseFloat(row[yCol] ?? "");
    if (Number.isNaN(y)) continue;
    const g = row[seriesCol] ?? "";
    const byInstant = lookup.get(g) ?? new Map<number, number>();
    byInstant.set(t, y);
    lookup.set(g, byInstant);
  }
  return {
    xAxis: TIME_X_AXIS,
    legend: { data: groups },
    series: groups.map((g) => ({
      type: chartType,
      name: g,
      data: [...nameByInstant].map(([t, name]) => ({
        name,
        value: [t, lookup.get(g)?.get(t) ?? null],
      })),
    })),
  } as Partial<EChartsOption>;
}

/** No y mapping: every numeric column (skipping x) is a series over the plotted rows. */
export function buildTimeAutoSeries(
  rawRows: string[][],
  timed: readonly TimedRow[],
  headers: string[],
  xCol: number,
  chartType: ChartType,
): Partial<EChartsOption> {
  const series: Array<Record<string, unknown>> = [];
  for (let col = 0; col < headers.length; col++) {
    if (col === xCol) continue;
    if (!rawRows.some((r) => !Number.isNaN(parseFloat(r[col] ?? "")))) continue;
    series.push({
      type: chartType,
      name: headers[col],
      data: timed.map(({ t, row }) => ({
        name: row[xCol] ?? "",
        value: [t, numberOrNull(row[col])],
      })),
    });
  }
  if (series.length === 0) return {};
  return {
    xAxis: TIME_X_AXIS,
    legend: { data: series.map((s) => s.name as string) },
    series,
  } as Partial<EChartsOption>;
}

/** Scatter on a time axis: `[epochMillis, y(, size)]`, optionally one series per `colorField` value.
 *  A row whose y is not numeric draws no point. */
export function buildTimeScatter(
  rawRows: string[][],
  timed: readonly TimedRow[],
  headers: string[],
  xCol: number,
  yCol: number,
  scatterOptions?: ScatterChartOptions,
): Partial<EChartsOption> {
  const sizeCol = scatterOptions?.sizeField ? headers.indexOf(scatterOptions.sizeField) : -1;
  const colorCol = scatterOptions?.colorField ? headers.indexOf(scatterOptions.colorField) : -1;
  const plotted = timed.filter(({ row }) => !Number.isNaN(parseFloat(row[yCol] ?? "")));
  const toPoint = ({ t, row }: TimedRow) => {
    const value = [t, parseFloat(row[yCol] ?? "")];
    if (sizeCol !== -1) value.push(numberOr0(parseFloat(row[sizeCol] ?? "")));
    return { name: row[xCol] ?? "", value };
  };
  const symbolSize =
    sizeCol !== -1
      ? makeScatterSymbolSize(rawRows.map((r) => parseFloat(r[sizeCol] ?? "")))
      : undefined;
  const extra = symbolSize ? { symbolSize } : {};
  if (colorCol !== -1) {
    const groups = [...new Set(rawRows.map((r) => r[colorCol] ?? ""))];
    return {
      xAxis: TIME_X_AXIS,
      legend: { data: groups },
      series: groups.map((group) => ({
        type: "scatter",
        name: group,
        data: plotted.filter(({ row }) => (row[colorCol] ?? "") === group).map(toPoint),
        ...extra,
      })),
    } as Partial<EChartsOption>;
  }
  return {
    xAxis: TIME_X_AXIS,
    series: [{ type: "scatter", data: plotted.map(toPoint), ...extra }],
  } as Partial<EChartsOption>;
}

/** An aggregation grouped by a timestamp field: the group keys are the x values, already parsed and
 *  ordered by the plan (a key that denotes no instant, including the `"null"` group, is not plotted). */
export function buildTimeAggregate(
  aggregate: GroupedAggregate,
  points: readonly AggregatePoint[],
  chartType: ChartType,
): Partial<EChartsOption> {
  return {
    xAxis: TIME_X_AXIS,
    series: [
      {
        type: chartType as "bar" | "line",
        ...(aggregate.seriesName ? { name: aggregate.seriesName } : {}),
        data: points.map((p) => ({ name: p.name, value: [p.t, p.y] })),
      },
    ],
  } as Partial<EChartsOption>;
}
