import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import type { ChartTypeOptionsMap, PanelAppearance, ScatterChartOptions } from "../types/panel";
import { appearanceToEChartsOption } from "../../../utils/chartAppearance";
import type { ChartType } from "../../../utils/chartAppearance";
import { applyChartTypeOptions, makeScatterSymbolSize } from "../../../utils/chartTypeOptions";
import type { GroupedAggregate } from "../../../utils/aggregate";

const defaultOption: EChartsOption = {
  legend: { show: true },
  xAxis: { type: "category", name: "X Axis", data: [] },
  yAxis: { type: "value", name: "Y Axis" },
  series: [{ type: "line" }],
};

/** `compact` mode (HEL-301, phone stack): axis-label font size, shrunk from
 *  ECharts' default to fit the narrow phone width (W5: "fix via ECharts
 *  config, not CSS" — this is an ECharts option value, not a CSS token). */
const COMPACT_AXIS_LABEL_FONT_SIZE = 10;

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

  // Pie: [{ name, value }] from x (label) and y (value)
  if (chartType === "pie" && yCol !== -1) {
    const data = rawRows.map((r) => ({
      name: r[xCol] ?? "",
      value: parseFloat(r[yCol] ?? "") || 0,
    }));
    return {
      series: [{ type: "pie", data }],
    };
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
   *  `chartType` is `bar`/`line` — pie/scatter (or an absent aggregate) fall
   *  back to the existing per-row `rawRows` path unchanged. */
  chartAggregate?: GroupedAggregate | null;
  /** HEL-248: persisted per-chart-type display options. The active chart type's
   *  entry is applied to the built option; entries for other types are ignored
   *  on render but preserved in storage. */
  chartOptions?: ChartTypeOptionsMap | null;
  /** HEL-301 (W5): true when rendered in the phone stack, where there is no
   *  room for a legend and full-size axis labels overflow. Hides the legend
   *  and shrinks axis label font via ECharts config — "fix via ECharts
   *  config, not CSS" per the binding handoff — rather than clipping with
   *  `overflow: hidden`. Defaults to false; desktop is unaffected. */
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
  const { option: appearanceOption, chartType } =
    appearance?.chart != null
      ? appearanceToEChartsOption(appearance.chart)
      : { option: {} as EChartsOption, chartType: "line" as ChartType };

  const useAggregate = chartAggregate != null && (chartType === "bar" || chartType === "line");

  const dataOption = useAggregate
    ? buildAggregateDataOption(chartAggregate, chartType)
    : rawRows && rawRows.length > 0 && headers && headers.length > 0
      ? buildDataOption(rawRows, headers, fieldMapping, chartType, chartOptions?.scatter)
      : {};

  const isPie = chartType === "pie";

  const textColor = appearance?.color;
  const textStyle = textColor ? { color: textColor } : {};

  let option: EChartsOption;
  if (isPie) {
    const { xAxis: _axA, yAxis: _ayA, ...appearOpt } = appearanceOption;
    const { xAxis: _axD, yAxis: _ayD, series: _sD, ...defaultOpt } = defaultOption;
    option = {
      ...defaultOpt,
      ...dataOption,
      ...appearOpt,
      backgroundColor: "transparent",
      textStyle,
      legend: { ...(dataOption.legend as object), ...(appearOpt.legend as object), textStyle },
    };
  } else {
    option = {
      ...defaultOption,
      ...dataOption,
      ...appearanceOption,
      backgroundColor: "transparent",
      textStyle,
      xAxis: {
        ...(dataOption.xAxis as object),
        ...(appearanceOption.xAxis as object),
        nameTextStyle: textStyle,
        axisLabel: { color: textColor },
      },
      yAxis: {
        ...(defaultOption.yAxis as object),
        ...(appearanceOption.yAxis as object),
        nameTextStyle: textStyle,
        axisLabel: { color: textColor },
      },
      legend: {
        ...(dataOption.legend as object),
        ...(appearanceOption.legend as object),
        textStyle,
      },
    };
  }

  // HEL-248 — apply the active chart type's persisted display options (line
  // smoothing/markers/area, bar stacking/orientation/gap, pie donut/labels)
  // after appearance merge and before the mobile `compact` pass, so `compact`
  // (HEL-301) stays the last transform and is unchanged.
  option = applyChartTypeOptions(option, chartType, chartOptions);

  if (compact) {
    option = {
      ...option,
      legend: { ...(option.legend as object), show: false },
      ...(isPie
        ? {}
        : {
            xAxis: {
              ...(option.xAxis as object),
              axisLabel: {
                ...(option.xAxis as { axisLabel?: object } | undefined)?.axisLabel,
                fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
              },
            },
            yAxis: {
              ...(option.yAxis as object),
              axisLabel: {
                ...(option.yAxis as { axisLabel?: object } | undefined)?.axisLabel,
                fontSize: COMPACT_AXIS_LABEL_FONT_SIZE,
              },
            },
          }),
    };
  }

  return (
    <ReactECharts
      option={option}
      notMerge={true}
      autoResize={true}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
