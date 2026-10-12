// HEL-1305 — the time-axis half of `buildDataOptionCore` / `buildAggregateDataOption`. A timestamp x
// field plots every point as `{name: <raw x>, value: [epochMillis, y]}` on `xAxis: {type: "time"}`:
// `name` keeps the row's raw x so click filtering (`params.name`) matches rows literally.

import type { EChartsOption } from "echarts";

import type { ScatterChartOptions } from "../types/panel";
import type { ChartType } from "../../../utils/chartAppearance";
import type { GroupedAggregate } from "../../../utils/aggregate";
import { makeScatterSymbolSize } from "../../../utils/chartTypeOptions";
import { isTimeXField, parseChartInstant } from "../../../utils/chartTimeAxis";
import type { ChartFieldTypes } from "../../../utils/chartTimeAxis";

/** What the builders need to decide on a time axis (owner ruling 5: not horizontal bar). */
export interface TimeAxisContext {
  fieldTypes?: ChartFieldTypes | null;
  horizontalBar?: boolean;
}

/** `true` when the plotted x field is declared `timestamp` and the chart type has a time axis. */
export function wantsTimeAxis(
  chartType: ChartType,
  ctx: TimeAxisContext | undefined,
  xField: string | undefined,
): boolean {
  if (!ctx || !isTimeXField(ctx.fieldTypes, xField)) return false;
  return (
    chartType === "line" || chartType === "scatter" || (chartType === "bar" && !ctx.horizontalBar)
  );
}

const TIME_X_AXIS = { type: "time" } as const;

const numberOr0 = (n: number) => (Number.isNaN(n) ? 0 : n);

interface TimedRow {
  t: number;
  row: string[];
}

/** Rows whose x parses, ordered by instant; ties keep row order. A row with no instant has no
 *  position on the axis and is not plotted. */
function timedRows(rawRows: string[][], xCol: number): TimedRow[] {
  const timed: TimedRow[] = [];
  for (const row of rawRows) {
    const t = parseChartInstant(row[xCol]);
    if (t !== null) timed.push({ t, row });
  }
  return timed.sort((a, b) => a.t - b.t);
}

/** Single series: one value per plotted row (a non-numeric y plots 0, as on a category axis). */
export function buildTimeSingleSeries(
  rawRows: string[][],
  headers: string[],
  xCol: number,
  yCol: number,
  chartType: ChartType,
): Partial<EChartsOption> {
  const data = timedRows(rawRows, xCol).map(({ t, row }) => ({
    name: row[xCol] ?? "",
    value: [t, numberOr0(parseFloat(row[yCol] ?? ""))],
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
  xCol: number,
  yCol: number,
  seriesCol: number,
  chartType: ChartType,
): Partial<EChartsOption> {
  const timed = timedRows(rawRows, xCol);
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
  headers: string[],
  xCol: number,
  chartType: ChartType,
): Partial<EChartsOption> {
  const timed = timedRows(rawRows, xCol);
  const series: Array<Record<string, unknown>> = [];
  for (let col = 0; col < headers.length; col++) {
    if (col === xCol) continue;
    if (!rawRows.some((r) => !Number.isNaN(parseFloat(r[col] ?? "")))) continue;
    series.push({
      type: chartType,
      name: headers[col],
      data: timed.map(({ t, row }) => ({
        name: row[xCol] ?? "",
        value: [t, numberOr0(parseFloat(row[col] ?? ""))],
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

/** Scatter on a time axis: `[epochMillis, y(, size)]`, optionally one series per `colorField` value. */
export function buildTimeScatter(
  rawRows: string[][],
  headers: string[],
  xCol: number,
  yCol: number,
  scatterOptions?: ScatterChartOptions,
): Partial<EChartsOption> {
  const sizeCol = scatterOptions?.sizeField ? headers.indexOf(scatterOptions.sizeField) : -1;
  const colorCol = scatterOptions?.colorField ? headers.indexOf(scatterOptions.colorField) : -1;
  const timed = timedRows(rawRows, xCol);
  const toPoint = ({ t, row }: TimedRow) => {
    const value = [t, numberOr0(parseFloat(row[yCol] ?? ""))];
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
        data: timed.filter(({ row }) => (row[colorCol] ?? "") === group).map(toPoint),
        ...extra,
      })),
    } as Partial<EChartsOption>;
  }
  return {
    xAxis: TIME_X_AXIS,
    series: [{ type: "scatter", data: timed.map(toPoint), ...extra }],
  } as Partial<EChartsOption>;
}

/** An aggregation grouped by a timestamp field: the group keys are the x values. A key that denotes
 *  no instant (including the `"null"` group) is not plotted. */
export function buildTimeAggregate(
  aggregate: GroupedAggregate,
  chartType: ChartType,
): Partial<EChartsOption> {
  const points = aggregate.categories
    .flatMap((category, i) => {
      const t = parseChartInstant(category);
      return t === null ? [] : [{ t, name: category, y: aggregate.values[i] }];
    })
    .sort((a, b) => a.t - b.t);
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
