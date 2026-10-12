// HEL-1508 — the one echarts-free decision "does this chart plot on a time axis?". The option builder
// (`buildChartOption`) and the footnote (`ChartRenderer`) both call `resolveChartPlan`, so the axis a chart
// draws and the "rows not shown" note that goes with it can never disagree. Kept free of any echarts
// runtime import so the main bundle can use it without pulling the lazy echarts chunk in (HEL-512).

import { defaultChartAppearance } from "../theme/appearance";
import type { ChartTypeOptionsMap, PanelAppearance } from "../features/panels/types/panel";
import type { GroupedAggregate } from "./aggregate";
import { resolveChartType } from "./chartAppearance";
import { resolveDataColumns } from "./chartClickSelection";
import { parseChartInstant, wantsTimeAxis } from "./chartTimeAxis";
import type { ChartFieldTypes, TimeAxisContext } from "./chartTimeAxis";
import type { ChartType } from "./chartTypes";

export interface TimedRow {
  t: number;
  row: string[];
}

export interface AggregatePoint {
  t: number;
  name: string;
  y: number;
}

/** How a raw-row chart plots its x axis. `time` carries the parsed rows (ordered by instant, ties keep
 *  row order) so no builder parses x again; `category-fallback` carries the rows reordered for the
 *  category axis (rows with an instant first, ascending, then the rest in row order). */
export type TimeAxisPlan =
  | { kind: "none" }
  | { kind: "time"; timed: TimedRow[]; omitted: number }
  | { kind: "category-fallback"; ordered: string[][] };

export type AggregateTimePlan =
  | { kind: "none" }
  | { kind: "time"; points: AggregatePoint[]; omittedGroups: number };

export type ChartTimePlan = TimeAxisPlan | AggregateTimePlan;

function hasNumericColumn(rawRows: string[][], headers: string[], xCol: number): boolean {
  return headers.some(
    (_, col) => col !== xCol && rawRows.some((r) => !Number.isNaN(parseFloat(r[col] ?? ""))),
  );
}

/** `true` when two rows denote the same instant (compared by epoch millis, not spelling). */
function repeatsAnInstant(timed: readonly TimedRow[]): boolean {
  return new Set(timed.map((r) => r.t)).size < timed.length;
}

export function planTimeAxis(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
  chartType: ChartType,
  timeCtx: TimeAxisContext | undefined,
): TimeAxisPlan {
  if (rawRows.length === 0 || headers.length === 0) return { kind: "none" };
  const { xCol, yCol, seriesCol } = resolveDataColumns(headers, fieldMapping);
  if (xCol === -1 || !wantsTimeAxis(chartType, timeCtx, headers[xCol])) return { kind: "none" };

  // No y mapping: the builder auto-detects numeric columns, and plots nothing when there are none.
  if (yCol === -1 && !hasNumericColumn(rawRows, headers, xCol)) return { kind: "none" };

  const timed: TimedRow[] = [];
  const unparseable: string[][] = [];
  for (const row of rawRows) {
    const t = parseChartInstant(row[xCol]);
    if (t === null) unparseable.push(row);
    else timed.push({ t, row });
  }
  timed.sort((a, b) => a.t - b.t);

  // One point per row: a mapped y without a series column, or the auto-detected series.
  const onePointPerRow = yCol === -1 || seriesCol === -1;
  if (chartType === "bar" && onePointPerRow && repeatsAnInstant(timed)) {
    return { kind: "category-fallback", ordered: [...timed.map((r) => r.row), ...unparseable] };
  }
  return { kind: "time", timed, omitted: unparseable.length };
}

export function planAggregateTimeAxis(
  aggregate: GroupedAggregate,
  chartType: ChartType,
  timeCtx: TimeAxisContext | undefined,
): AggregateTimePlan {
  if (
    (chartType !== "line" && chartType !== "bar") ||
    !wantsTimeAxis(chartType, timeCtx, aggregate.groupBy)
  ) {
    return { kind: "none" };
  }
  const points: AggregatePoint[] = [];
  aggregate.categories.forEach((name, i) => {
    const t = parseChartInstant(name);
    if (t !== null) points.push({ t, name, y: aggregate.values[i] });
  });
  points.sort((a, b) => a.t - b.t);
  return { kind: "time", points, omittedGroups: aggregate.categories.length - points.length };
}

export interface ChartPlanInput {
  appearance?: PanelAppearance | null;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  chartAggregate?: GroupedAggregate | null;
  chartOptions?: ChartTypeOptionsMap | null;
  fieldTypes?: ChartFieldTypes | null;
}

interface ChartPlanBase {
  chartType: ChartType;
  timeCtx: TimeAxisContext;
}

export type ChartPlan =
  | (ChartPlanBase & { source: "aggregate"; timePlan: AggregateTimePlan })
  | (ChartPlanBase & { source: "rows"; timePlan: TimeAxisPlan })
  | (ChartPlanBase & { source: "empty"; timePlan: { kind: "none" } });

/** Everything `buildChartOption` decides before it builds data: chart type (an absent
 *  `appearance.chart` renders as the default appearance), time-axis context, whether the data is a
 *  precomputed aggregate or raw rows, and the time-axis plan for it. */
export function resolveChartPlan(input: ChartPlanInput): ChartPlan {
  const { appearance, rawRows, headers, fieldMapping, chartAggregate, chartOptions, fieldTypes } =
    input;
  const chartType = resolveChartType(appearance?.chart ?? defaultChartAppearance);
  const timeCtx: TimeAxisContext = {
    fieldTypes,
    horizontalBar: chartType === "bar" && chartOptions?.bar?.orientation === "horizontal",
  };
  const useAggregate =
    chartAggregate != null && (chartType === "bar" || chartType === "line" || chartType === "pie");
  if (useAggregate) {
    return {
      chartType,
      timeCtx,
      source: "aggregate",
      timePlan: planAggregateTimeAxis(chartAggregate, chartType, timeCtx),
    };
  }
  if (rawRows && rawRows.length > 0 && headers && headers.length > 0) {
    return {
      chartType,
      timeCtx,
      source: "rows",
      timePlan: planTimeAxis(rawRows, headers, fieldMapping, chartType, timeCtx),
    };
  }
  return { chartType, timeCtx, source: "empty", timePlan: { kind: "none" } };
}

/** "3 rows with no readable date not shown." / "1 group with no readable date not shown."; `null`
 *  when the plan is not a time axis or nothing was left out. */
export function timeAxisOmittedNote(plan: ChartTimePlan): string | null {
  if (plan.kind !== "time") return null;
  const [count, noun] =
    "omittedGroups" in plan ? [plan.omittedGroups, "group"] : [plan.omitted, "row"];
  if (count <= 0) return null;
  return `${count} ${noun}${count === 1 ? "" : "s"} with no readable date not shown.`;
}
