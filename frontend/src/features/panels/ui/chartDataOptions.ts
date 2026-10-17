import type { EChartsOption } from "echarts";

import type { HistogramChartOptions, ScatterChartOptions } from "../types/panel";
import type { ChartType } from "../../../utils/chartAppearance";
import { makeScatterSymbolSize } from "../../../utils/chartTypeOptions";
import type { GroupedAggregate } from "../../../utils/aggregate";
// HEL-572 — kept as a SEPARATE, echarts-import-free module (see its own
// header comment) so `usePanelCardInspect.ts`/`PanelFullscreenOverlay.tsx` can reuse
// the row-filter half without pulling this file's lazy-loaded echarts chunk
// into the main bundle (HEL-512).
import { resolveDataColumns, resolvePieValueColumn } from "../../../utils/chartClickSelection";
import { buildHeatmapDataOption, buildHistogramDataOption } from "./heatmapHistogramOptions";
import {
  buildTimeAggregate,
  buildTimeAutoSeries,
  buildTimeMultiSeries,
  buildTimeScatter,
  buildTimeSingleSeries,
} from "./chartTimeDataOptions";
import type { TimeAxisContext } from "../../../utils/chartTimeAxis";
import { planAggregateTimeAxis, planTimeAxis } from "../../../utils/chartTimePlan";
import type { AggregateTimePlan, TimeAxisPlan } from "../../../utils/chartTimePlan";

/** HEL-572 design.md D6 — merges `cursor: "pointer"` onto every series entry
 *  a `buildDataOption` branch returns, applied here (a single post-process
 *  wrapping the whole function, see `buildDataOption` below) so it's
 *  impossible for a future branch to forget it, and so it stays entirely on
 *  the data-derived half of the option — never merged onto the
 *  `appearance`-derived half, which is what closes the HEL-1178 hazard (a
 *  chart panel with no stored `appearance.chart` still gets a clickable
 *  cursor, since this runs unconditionally regardless of `appearance`). */
export function withPointerCursor(
  dataOption: Partial<EChartsOption>,
  chartType?: ChartType,
): Partial<EChartsOption> {
  const series = dataOption.series;
  if (!Array.isArray(series) || series.length === 0) return dataOption;
  // HEL-1311 — a histogram bar is not clickable, so it must not advertise itself as one. (A heatmap
  // view ignores `cursor`; `ChartPanel` sets the canvas cursor for it instead.)
  const cursor = chartType === "histogram" ? "default" : "pointer";
  return { ...dataOption, series: series.map((s) => ({ ...(s as object), cursor })) };
}

/** HEL-1584 D10 — gives every series a stable `id` (`<type>:<name>`, `#n`-suffixed when the same type and name repeat), so
 *  a same-shape data refresh can update the existing series in place under ECharts' `replaceMerge: ["series"]` (and morph on
 *  `animationDurationUpdate`) instead of replacing the chart. An id a builder already set is kept. Applied here, as a
 *  post-process over the whole data option (like `withPointerCursor`), so no builder branch can forget it. */
export function withSeriesIds(
  dataOption: Partial<EChartsOption>,
  chartType: ChartType,
): Partial<EChartsOption> {
  const series = dataOption.series;
  if (!Array.isArray(series) || series.length === 0) return dataOption;
  const seen = new Map<string, number>();
  return {
    ...dataOption,
    series: series.map((s) => {
      const entry = s as { id?: unknown; name?: unknown; type?: unknown };
      if (entry.id !== undefined) return s;
      const base = `${typeof entry.type === "string" ? entry.type : chartType}:${
        typeof entry.name === "string" ? entry.name : ""
      }`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return { ...(s as object), id: count === 0 ? base : `${base}#${count}` };
    }),
  } as Partial<EChartsOption>;
}

export function buildDataOption(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
  chartType: ChartType,
  scatterOptions?: ScatterChartOptions,
  histogramOptions?: HistogramChartOptions,
  timeCtx?: TimeAxisContext,
  timePlan?: TimeAxisPlan,
): Partial<EChartsOption> {
  return withSeriesIds(
    withPointerCursor(
      buildDataOptionCore(
        rawRows,
        headers,
        fieldMapping,
        chartType,
        scatterOptions,
        histogramOptions,
        timeCtx,
        timePlan,
      ),
      chartType,
    ),
    chartType,
  );
}

export function buildDataOptionCore(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
  chartType: ChartType,
  scatterOptions?: ScatterChartOptions,
  histogramOptions?: HistogramChartOptions,
  timeCtx?: TimeAxisContext,
  timePlan?: TimeAxisPlan,
): Partial<EChartsOption> {
  if (rawRows.length === 0 || headers.length === 0) return {};

  // HEL-1311 — checked before `resolveDataColumns`, whose unmapped-x fallback is column 0.
  if (chartType === "heatmap") return buildHeatmapDataOption(rawRows, headers, fieldMapping);
  if (chartType === "histogram") {
    return buildHistogramDataOption(rawRows, headers, fieldMapping, histogramOptions);
  }

  // HEL-572 tasks.md 2.1 / design.md D4 — extracted so `mapChartClickToSelection`/
  // `filterRowsForSelection` (chartClickSelection.ts) can never resolve a
  // different column than what was actually plotted here.
  const { xCol, yCol, seriesCol } = resolveDataColumns(headers, fieldMapping);

  if (xCol === -1) return {};

  // HEL-1305/HEL-1508 — a timestamp x field (declared in the Output's schema) plots on a time axis,
  // except a vertical bar repeating an instant, which keeps one bar per row on a category axis over the
  // plan's instant-ordered rows. `buildChartOption` hands in the plan its footnote is also derived from.
  const plan = timePlan ?? planTimeAxis(rawRows, headers, fieldMapping, chartType, timeCtx);
  const timed = plan.kind === "time" ? plan.timed : null;
  if (plan.kind === "category-fallback") rawRows = plan.ordered;

  // Scatter: coordinate pairs [[x, y], ...], optionally with a third `size`
  // dimension (`sizeField` → bubble sizing) and/or grouped into one series per
  // distinct `colorField` value (legend entry per group). HEL-248.
  if (chartType === "scatter" && yCol !== -1) {
    if (timed) return buildTimeScatter(rawRows, timed, headers, xCol, yCol, scatterOptions);
    const sizeCol = scatterOptions?.sizeField ? headers.indexOf(scatterOptions.sizeField) : -1;
    const colorCol = scatterOptions?.colorField ? headers.indexOf(scatterOptions.colorField) : -1;

    // HEL-1508 — a row with no numeric y draws no point.
    const plotted = rawRows.filter((r) => !isNaN(parseFloat(r[yCol] ?? "")));
    const toPoint = (r: string[]): number[] => {
      const xVal = parseFloat(r[xCol] ?? "");
      const point = [isNaN(xVal) ? 0 : xVal, parseFloat(r[yCol] ?? "")];
      if (sizeCol !== -1) {
        const sizeVal = parseFloat(r[sizeCol] ?? "");
        point.push(isNaN(sizeVal) ? 0 : sizeVal);
      }
      return point;
    };

    const symbolSize =
      sizeCol !== -1
        ? makeScatterSymbolSize(rawRows.map((r) => parseFloat(r[sizeCol] ?? "")))
        : undefined;

    if (colorCol !== -1) {
      const groups = [...new Set(rawRows.map((r) => r[colorCol] ?? ""))];
      return {
        legend: { data: groups },
        series: groups.map((group) => ({
          type: "scatter",
          name: group,
          data: plotted.filter((r) => (r[colorCol] ?? "") === group).map(toPoint),
          ...(symbolSize ? { symbolSize } : {}),
        })),
      };
    }

    return {
      series: [
        { type: "scatter", data: plotted.map(toPoint), ...(symbolSize ? { symbolSize } : {}) },
      ],
    };
  }

  // Pie: [{ name, value }] from x (label) and y (value). F-027 — this branch
  // used to require `yCol !== -1` and silently fall through to the generic
  // "auto-detect numeric columns" branch below otherwise, which returns a
  // cartesian `{xAxis, series:[{type:'pie', data: number[]}]}` shape: an
  // orphaned category `xAxis` with no matching `grid` (invalid — crashes
  // ECharts' axis builder) carrying a bare-number series (wrong shape for
  // pie, which needs `{name,value}[]`). Branching on `chartType === 'pie'`
  // unconditionally, before that fallthrough, closes both defects at once.
  if (chartType === "pie") {
    // HEL-572 tasks.md 2.1/2.3 — `resolvePieValueColumn` (chartClickSelection.ts)
    // is the SAME mapped-or-auto-detected resolution previously inlined
    // here (yCol when mapped, else the first numeric column skipping xCol)
    // — shared with `mapChartClickToSelection`'s pie branch (design.md D3)
    // so a click can never resolve a different value column than the one
    // that actually built the slice.
    const valueCol = resolvePieValueColumn(rawRows, headers, xCol, yCol);
    if (valueCol === -1) return {};
    const data = rawRows.map((r) => ({
      name: r[xCol] ?? "",
      value: parseFloat(r[valueCol] ?? "") || 0,
    }));
    return { series: [{ type: "pie", data }] };
  }

  if (seriesCol !== -1 && yCol !== -1) {
    if (timed) return buildTimeMultiSeries(rawRows, timed, xCol, yCol, seriesCol, chartType);
    // Group rows by unique series-column values, x-values are shared categories
    const allX = [...new Set(rawRows.map((r) => r[xCol] ?? ""))];
    const groups = [...new Set(rawRows.map((r) => r[seriesCol] ?? ""))];

    const lookup: Record<string, Record<string, number>> = {};
    for (const row of rawRows) {
      const x = row[xCol] ?? "";
      const g = row[seriesCol] ?? "";
      const y = parseFloat(row[yCol] ?? "");
      if (!lookup[g]) lookup[g] = {};
      if (!isNaN(y)) lookup[g][x] = y;
    }

    return {
      xAxis: { type: "category", data: allX },
      legend: { data: groups },
      series: groups.map((g) => ({
        type: chartType,
        name: g,
        // HEL-1305 — no value for this series at this x is a gap, not a real zero.
        data: allX.map((x) => lookup[g]?.[x] ?? null),
      })),
    };
  }

  if (yCol !== -1) {
    if (timed) return buildTimeSingleSeries(timed, headers, xCol, yCol, chartType);
    // Single series: x categories from xCol, y values from yCol; a non-numeric y is a gap (HEL-1508)
    const categories = rawRows.map((r) => r[xCol] ?? "");
    const values = rawRows.map((r) => {
      const n = parseFloat(r[yCol] ?? "");
      return isNaN(n) ? null : n;
    });
    return {
      xAxis: { type: "category", data: categories },
      legend: { data: [headers[yCol]] },
      series: [{ type: chartType, name: headers[yCol], data: values }],
    };
  }

  // No y mapping — auto-detect numeric columns (skipping xCol)
  if (timed) return buildTimeAutoSeries(rawRows, timed, headers, xCol, chartType);
  const categories = rawRows.map((r) => r[xCol] ?? "");
  const autoSeries: Array<{ name: string; data: Array<number | null> }> = [];
  for (let col = 0; col < headers.length; col++) {
    if (col === xCol) continue;
    const parsed = rawRows.map((r) => parseFloat(r[col] ?? ""));
    if (parsed.some((n) => !isNaN(n))) {
      autoSeries.push({ name: headers[col], data: parsed.map((n) => (isNaN(n) ? null : n)) });
    }
  }
  if (autoSeries.length === 0) return {};

  return {
    xAxis: { type: "category", data: categories },
    legend: { data: autoSeries.map((s) => s.name) },
    series: autoSeries.map((s) => ({ type: chartType, name: s.name, data: s.data })),
  };
}

/** HEL-292 — render a precomputed groupBy aggregate (`categories`/`values`
 *  from `usePanelData`'s `groupAndAggregate` over typed rows) directly,
 *  instead of grouping `rawRows`. `ChartPanel` never re-derives grouping from
 *  stringified data — see design.md Decision 4. */
export function buildAggregateDataOption(
  aggregate: GroupedAggregate,
  chartType: ChartType,
  timeCtx?: TimeAxisContext,
  timePlan?: AggregateTimePlan,
): Partial<EChartsOption> {
  return withSeriesIds(
    buildAggregateDataOptionCore(aggregate, chartType, timeCtx, timePlan),
    chartType,
  );
}

function buildAggregateDataOptionCore(
  aggregate: GroupedAggregate,
  chartType: ChartType,
  timeCtx?: TimeAxisContext,
  timePlan?: AggregateTimePlan,
): Partial<EChartsOption> {
  const plan = timePlan ?? planAggregateTimeAxis(aggregate, chartType, timeCtx);
  if (plan.kind === "time") return buildTimeAggregate(aggregate, plan.points, chartType);
  if (chartType === "pie") {
    return {
      series: [
        {
          type: "pie",
          data: aggregate.categories.map((name, i) => ({ name, value: aggregate.values[i] })),
        },
      ],
    };
  }

  return {
    xAxis: { type: "category", data: aggregate.categories },
    series: [
      {
        // Aggregate rendering is bar/line/pie only (`useAggregate` in `buildChartOption`).
        type: chartType as "bar" | "line",
        ...(aggregate.seriesName ? { name: aggregate.seriesName } : {}),
        data: aggregate.values,
      },
    ],
  };
}
