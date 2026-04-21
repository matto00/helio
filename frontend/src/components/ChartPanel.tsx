import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import type { PanelAppearance } from "../types/models";
import { appearanceToEChartsOption } from "../utils/chartAppearance";
import type { ChartType } from "../utils/chartAppearance";

const defaultOption: EChartsOption = {
  legend: { show: true },
  xAxis: { type: "category", name: "X Axis", data: [] },
  yAxis: { type: "value", name: "Y Axis" },
  series: [{ type: "line" }],
};

function buildDataOption(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
  chartType: ChartType,
): Partial<EChartsOption> {
  if (rawRows.length === 0 || headers.length === 0) return {};

  const xColName = fieldMapping?.xAxis;
  const yColName = fieldMapping?.yAxis;
  const seriesColName = fieldMapping?.series;

  const xCol = xColName ? headers.indexOf(xColName) : 0;
  const yCol = yColName ? headers.indexOf(yColName) : -1;
  const seriesCol = seriesColName ? headers.indexOf(seriesColName) : -1;

  if (xCol === -1) return {};

  // Scatter: coordinate pairs [[x, y], ...]
  if (chartType === "scatter" && yCol !== -1) {
    const data = rawRows.map((r) => {
      const xVal = parseFloat(r[xCol] ?? "");
      const yVal = parseFloat(r[yCol] ?? "");
      return [isNaN(xVal) ? 0 : xVal, isNaN(yVal) ? 0 : yVal] as [number, number];
    });
    return {
      series: [{ type: "scatter", data }],
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

export interface ChartPanelProps {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
}

export function ChartPanel({ appearance, rawRows, headers, fieldMapping }: ChartPanelProps = {}) {
  const { option: appearanceOption, chartType } =
    appearance?.chart != null
      ? appearanceToEChartsOption(appearance.chart)
      : { option: {} as EChartsOption, chartType: "line" as ChartType };

  const dataOption =
    rawRows && rawRows.length > 0 && headers && headers.length > 0
      ? buildDataOption(rawRows, headers, fieldMapping, chartType)
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

  return (
    <ReactECharts
      option={option}
      notMerge={true}
      autoResize={true}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
