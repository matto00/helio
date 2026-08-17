import { useMemo, useRef } from "react";
// F-022 — `/core` entry point + our own selectively-registered `echarts`
// instance (`echartsCore.ts`), instead of the default `echarts-for-react`
// export, which hard-imports the full, non-tree-shakeable `echarts` package
// (1.12 MB min / 369 KB gzip) and auto-registers every chart type/component
// it ships, defeating bundler tree-shaking regardless of what's actually
// used here (bar/line/pie/scatter only — see `ChartType`).
import ReactECharts from "echarts-for-react/esm/core";
import type { EChartsOption } from "echarts";

import type { ChartTypeOptionsMap, PanelAppearance, ScatterChartOptions } from "../types/panel";
import { appearanceToEChartsOption, resolveChartTheme } from "../../../utils/chartAppearance";
import type { ChartType } from "../../../utils/chartAppearance";
import { applyChartTypeOptions, makeScatterSymbolSize } from "../../../utils/chartTypeOptions";
import type { GroupedAggregate } from "../../../utils/aggregate";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  CHART_COMPACT_HEIGHT_PX,
  PIE_LEGEND_HIDE_HEIGHT_PX,
  useMeasuredChartHeight,
} from "./useChartCompact";
import echarts from "./echartsCore";

// `type`/`data` only — no placeholder `name` (unlike the persisted-appearance
// default, `defaultChartAppearance` in theme/appearance.ts, this is never
// actually surfaced: the option-assembly below always reconstructs `xAxis`/
// `yAxis` from `dataOption/appearanceOption` and never falls back to this
// object's own `name`). Kept type-shaped so `EChartsOption` inference below
// still holds when data/appearance are both absent (see the "no data" tests).
const defaultOption: EChartsOption = {
  legend: { show: true },
  xAxis: { type: "category", data: [] },
  yAxis: { type: "value" },
  series: [{ type: "line" }],
};

/** `compact` mode (HEL-301, phone stack + F-094/F-026 measured-small panels):
 *  axis-label font size, shrunk from ECharts' default to fit a narrow width
 *  (W5: "fix via ECharts config, not CSS" — this is an ECharts option value,
 *  not a CSS token). */
const COMPACT_AXIS_LABEL_FONT_SIZE = 10;

/** F-028 — compact-mode grid inset (px). Paired with `containLabel: true` so
 *  ECharts reserves exactly the space the (now-shrunk) axis labels/names
 *  need instead of its own default percentage-based margins, which — on a
 *  ~140px-tall mobile chart canvas — consumed nearly the entire box and left
 *  the plotted series a near-invisible sliver. */
const COMPACT_GRID_INSET_PX = 8;

function buildDataOption(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
  chartType: ChartType,
  scatterOptions?: ScatterChartOptions,
): Partial<EChartsOption> {
  if (rawRows.length === 0 || headers.length === 0) return {};

  const xColName = fieldMapping?.xAxis;
  const yColName = fieldMapping?.yAxis;
  const seriesColName = fieldMapping?.series;

  const xCol = xColName ? headers.indexOf(xColName) : 0;
  const yCol = yColName ? headers.indexOf(yColName) : -1;
  const seriesCol = seriesColName ? headers.indexOf(seriesColName) : -1;

  if (xCol === -1) return {};

  // Scatter: coordinate pairs [[x, y], ...], optionally with a third `size`
  // dimension (`sizeField` → bubble sizing) and/or grouped into one series per
  // distinct `colorField` value (legend entry per group). HEL-248.
  if (chartType === "scatter" && yCol !== -1) {
    const sizeCol = scatterOptions?.sizeField ? headers.indexOf(scatterOptions.sizeField) : -1;
    const colorCol = scatterOptions?.colorField ? headers.indexOf(scatterOptions.colorField) : -1;

    const toPoint = (r: string[]): number[] => {
      const xVal = parseFloat(r[xCol] ?? "");
      const yVal = parseFloat(r[yCol] ?? "");
      const point = [isNaN(xVal) ? 0 : xVal, isNaN(yVal) ? 0 : yVal];
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
          data: rawRows.filter((r) => (r[colorCol] ?? "") === group).map(toPoint),
          ...(symbolSize ? { symbolSize } : {}),
        })),
      };
    }

    return {
      series: [
        { type: "scatter", data: rawRows.map(toPoint), ...(symbolSize ? { symbolSize } : {}) },
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
    if (yCol !== -1) {
      const data = rawRows.map((r) => ({
        name: r[xCol] ?? "",
        value: parseFloat(r[yCol] ?? "") || 0,
      }));
      return { series: [{ type: "pie", data }] };
    }

    // No y mapping — auto-detect the first numeric column (skipping xCol),
    // same scan as the generic fallback below, but stopping at the first
    // hit: a pie series can only bind one value column.
    for (let col = 0; col < headers.length; col++) {
      if (col === xCol) continue;
      const parsed = rawRows.map((r) => parseFloat(r[col] ?? ""));
      if (parsed.some((n) => !isNaN(n))) {
        const data = rawRows.map((r, i) => ({
          name: r[xCol] ?? "",
          value: isNaN(parsed[i]) ? 0 : parsed[i],
        }));
        return { series: [{ type: "pie", data }] };
      }
    }
    // No numeric column anywhere — no valid pie slices to build.
    return {};
  }

  if (seriesCol !== -1 && yCol !== -1) {
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
        data: allX.map((x) => lookup[g]?.[x] ?? 0),
      })),
    };
  }

  if (yCol !== -1) {
    // Single series: x categories from xCol, y values from yCol
    const categories = rawRows.map((r) => r[xCol] ?? "");
    const values = rawRows.map((r) => {
      const n = parseFloat(r[yCol] ?? "");
      return isNaN(n) ? 0 : n;
    });
    return {
      xAxis: { type: "category", data: categories },
      legend: { data: [headers[yCol]] },
      series: [{ type: chartType, name: headers[yCol], data: values }],
    };
  }

  // No y mapping — auto-detect numeric columns (skipping xCol)
  const categories = rawRows.map((r) => r[xCol] ?? "");
  const autoSeries: Array<{ name: string; data: number[] }> = [];
  for (let col = 0; col < headers.length; col++) {
    if (col === xCol) continue;
    const parsed = rawRows.map((r) => parseFloat(r[col] ?? ""));
    if (parsed.some((n) => !isNaN(n))) {
      autoSeries.push({ name: headers[col], data: parsed.map((n) => (isNaN(n) ? 0 : n)) });
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
function buildAggregateDataOption(
  aggregate: GroupedAggregate,
  chartType: ChartType,
): Partial<EChartsOption> {
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
    series: [{ type: chartType, data: aggregate.values }],
  };
}

export interface ChartPanelProps {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  /** HEL-292: precomputed groupBy aggregate. Only applied when the rendered
   *  `chartType` is `bar`/`line`/`pie` (HEL-624) — scatter (or an absent
   *  aggregate) falls back to the existing per-row `rawRows` path unchanged. */
  chartAggregate?: GroupedAggregate | null;
  /** HEL-248: persisted per-chart-type display options. The active chart type's
   *  entry is applied to the built option; entries for other types are ignored
   *  on render but preserved in storage. */
  chartOptions?: ChartTypeOptionsMap | null;
  /** HEL-301: true when rendered in the phone stack, where there is no room
   *  for a legend and full-size axis labels overflow. Hides the legend and
   *  shrinks axis label font via ECharts config — "fix via ECharts config,
   *  not CSS" per the binding handoff — rather than clipping with `overflow:
   *  hidden`. Defaults to false; ORed with the chart's own measured size
   *  (F-094/F-026 — see `useMeasuredChartHeight`), so a short *desktop*
   *  chart gets the same treatment without needing this prop threaded to it. */
  compact?: boolean;
}

export function ChartPanel({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  chartOptions,
  compact = false,
}: ChartPanelProps = {}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const measuredHeight = useMeasuredChartHeight(wrapperRef);
  const measuredCompact = measuredHeight > 0 && measuredHeight <= CHART_COMPACT_HEIGHT_PX;
  const effectiveCompact = compact || measuredCompact;
  const measuredPieLegendOverlap =
    measuredHeight > 0 && measuredHeight <= PIE_LEGEND_HIDE_HEIGHT_PX;

  // `theme` is read only to force the memo below to recompute when the user
  // flips light/dark — `resolveChartTheme()` re-reads the live computed CSS
  // custom properties itself and isn't derived from this value directly.
  const { theme } = useTheme();

  // F-231 — this used to rebuild the full ECharts option object on every
  // render. Memoized on the actual inputs that can change its shape.
  const option = useMemo<EChartsOption>(() => {
    // Deliberate cache-buster (see the comment above the `useTheme()` call):
    // `resolveChartTheme()` re-reads the live computed CSS custom properties
    // itself rather than deriving from this value, so it's referenced here
    // only to justify `theme`'s presence in the dependency array below.
    void theme;

    const { option: appearanceOption, chartType } =
      appearance?.chart != null
        ? appearanceToEChartsOption(appearance.chart, resolveChartTheme())
        : { option: {} as EChartsOption, chartType: "line" as ChartType };

    const useAggregate =
      chartAggregate != null &&
      (chartType === "bar" || chartType === "line" || chartType === "pie");

    const dataOption = useAggregate
      ? buildAggregateDataOption(chartAggregate, chartType)
      : rawRows && rawRows.length > 0 && headers && headers.length > 0
        ? buildDataOption(rawRows, headers, fieldMapping, chartType, chartOptions?.scatter)
        : {};

    const isPie = chartType === "pie";

    const textColor = appearance?.color;
    const textStyleOverride = textColor ? { color: textColor } : {};
    // F-196: `appearanceOption.textStyle` is where chartAppearance.ts wires
    // `fontFamily: --font-sans` (and the tooltip/axisLabel equivalents). Every
    // spot below that renders its own `textStyle`-shaped object must MERGE
    // that base in rather than replace it outright, or the color override
    // silently drops the font — the bug this finding described (legend text
    // rendering in ECharts' canvas-default font instead of the app's).
    const baseTextStyle = (appearanceOption.textStyle as object | undefined) ?? {};
    const textStyle = { ...baseTextStyle, ...textStyleOverride };

    let built: EChartsOption;
    if (isPie) {
      const { xAxis: _axA, yAxis: _ayA, ...appearOpt } = appearanceOption;
      const { xAxis: _axD, yAxis: _ayD, series: _sD, ...defaultOpt } = defaultOption;
      built = {
        ...defaultOpt,
        ...dataOption,
        ...appearOpt,
        backgroundColor: "transparent",
        textStyle,
        legend: {
          ...(dataOption.legend as object),
          ...(appearOpt.legend as object),
          textStyle: {
            ...baseTextStyle,
            ...((appearOpt.legend as { textStyle?: object } | undefined)?.textStyle ?? {}),
            ...textStyleOverride,
          },
        },
      };
    } else {
      built = {
        ...defaultOption,
        ...dataOption,
        ...appearanceOption,
        backgroundColor: "transparent",
        textStyle,
        xAxis: {
          ...(dataOption.xAxis as object),
          ...(appearanceOption.xAxis as object),
          nameTextStyle: textStyle,
          axisLabel: {
            ...(appearanceOption.xAxis as { axisLabel?: object } | undefined)?.axisLabel,
            color: textColor,
          },
        },
        yAxis: {
          ...(defaultOption.yAxis as object),
          ...(appearanceOption.yAxis as object),
          nameTextStyle: textStyle,
          axisLabel: {
            ...(appearanceOption.yAxis as { axisLabel?: object } | undefined)?.axisLabel,
            color: textColor,
          },
        },
        legend: {
          ...(dataOption.legend as object),
          ...(appearanceOption.legend as object),
          textStyle: {
            ...baseTextStyle,
            ...((appearanceOption.legend as { textStyle?: object } | undefined)?.textStyle ?? {}),
            ...textStyleOverride,
          },
        },
      };
    }

    // HEL-248 — apply the active chart type's persisted display options (line
    // smoothing/markers/area, bar stacking/orientation/gap, pie donut/labels)
    // after appearance merge and before the mobile `compact` pass, so `compact`
    // (HEL-301) stays the last transform and is unchanged.
    built = applyChartTypeOptions(built, chartType, chartOptions);

    // F-026 — a pie's own outer data-labels extend well outside its donut
    // radius, so a top/bottom legend collides with them at a *taller*
    // measured height than the generic compact tier below is set for.
    // Independent of `effectiveCompact` so a default-sized (`h: 4`) pie
    // panel clears the collision even though it's well above the generic
    // small-chart threshold.
    const hideLegendForMeasuredSize = effectiveCompact || (isPie && measuredPieLegendOverlap);

    if (hideLegendForMeasuredSize) {
      built = { ...built, legend: { ...(built.legend as object), show: false } };
    }

    if (effectiveCompact && !isPie) {
      built = {
        ...built,
        // F-028 — an explicit small inset + `containLabel` so ECharts
        // reserves only the space the (shrunk) axis labels/names actually
        // need, instead of its own default percentage-based grid margins,
        // which ate nearly the whole plot area on a ~140px-tall mobile
        // chart canvas.
        grid: {
          ...(built.grid as object),
          top: COMPACT_GRID_INSET_PX,
          right: COMPACT_GRID_INSET_PX,
          bottom: COMPACT_GRID_INSET_PX,
          left: COMPACT_GRID_INSET_PX,
          containLabel: true,
        },
        xAxis: {
          ...(built.xAxis as object),
          axisLabel: {
            ...(built.xAxis as { axisLabel?: object } | undefined)?.axisLabel,
            fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
          },
          nameTextStyle: {
            ...(built.xAxis as { nameTextStyle?: object } | undefined)?.nameTextStyle,
            fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
          },
        },
        yAxis: {
          ...(built.yAxis as object),
          axisLabel: {
            ...(built.yAxis as { axisLabel?: object } | undefined)?.axisLabel,
            fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
          },
          nameTextStyle: {
            ...(built.yAxis as { nameTextStyle?: object } | undefined)?.nameTextStyle,
            fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
          },
        },
      };
    }

    return built;
  }, [
    appearance,
    rawRows,
    headers,
    fieldMapping,
    chartAggregate,
    chartOptions,
    effectiveCompact,
    measuredPieLegendOverlap,
    theme,
  ]);

  return (
    <div ref={wrapperRef} style={{ height: "100%", width: "100%" }}>
      <ReactECharts
        echarts={echarts}
        option={option}
        // Kept `true`: switching `chartType` between cartesian (bar/line/
        // scatter) and pie needs ECharts to fully replace its internal
        // series/axis state, not merge onto it — a stale `xAxis` or `series`
        // shape left over from the previous chart type is exactly the kind
        // of invalid-option crash F-027 fixes elsewhere. The real fix for
        // F-231's other complaint (rebuilding the option object itself) is
        // the `useMemo` above.
        notMerge={true}
        autoResize={true}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
