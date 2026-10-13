import type { EChartsOption } from "echarts";

import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartType } from "../../../utils/chartAppearance";
import type { ChartTypeOptionsMap } from "../types/panel";
import { buildChartOption } from "./buildChartOption";
import { tokens } from "./timeAxisTestSupport";

// HEL-1444 -- a value axis on a short canvas shows fewer labels instead of overprinting them. The
// option builder gets the cap `valueAxisSplitCap` derives from the measured canvas height; a tall
// canvas passes none and must build exactly the option it always did.

const headers = ["region", "revenue", "day", "ms"];
const rows = [
  ["East", "10", "2026-09-01", "10"],
  ["West", "150", "2026-09-02", "50"],
  ["North", "90", "2026-09-03", "90"],
];

function build(
  chartType: ChartType,
  mapping: Record<string, string>,
  opts: {
    cap?: number;
    compact?: boolean;
    chartOptions?: ChartTypeOptionsMap;
    fieldTypes?: Record<string, string>;
  } = {},
): EChartsOption {
  return buildChartOption({
    appearance: {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...defaultChartAppearance, chartType },
    },
    rawRows: rows,
    headers,
    fieldMapping: mapping,
    chartOptions: opts.chartOptions,
    fieldTypes: opts.fieldTypes,
    effectiveCompact: opts.compact ?? true,
    valueAxisSplitCap: opts.cap,
    measuredPieLegendOverlap: false,
    themeTokens: tokens,
    theme: "light",
  });
}

type YAxis = {
  type?: string;
  splitNumber?: number;
  axisLabel?: { hideOverlap?: boolean; showMinLabel?: boolean; showMaxLabel?: boolean };
};
const yAxisOf = (o: EChartsOption) => o.yAxis as YAxis;

const BAR = { xAxis: "region", yAxis: "revenue" };
const HIST = { xAxis: "ms" };
const TIME = { xAxis: "day", yAxis: "revenue" };

describe("buildChartOption value-axis label cap (HEL-1444)", () => {
  it.each([
    ["bar", "bar" as const, BAR, undefined],
    ["histogram", "histogram" as const, HIST, undefined],
    ["time-axis line", "line" as const, TIME, { day: "timestamp" }],
  ])("%s: a cap of 2 sets splitNumber and drops overlapping labels", (_n, type, mapping, ft) => {
    const y = yAxisOf(build(type, mapping, { cap: 2, fieldTypes: ft }));
    expect(y.type).toBe("value");
    expect(y.splitNumber).toBe(2);
    expect(y.axisLabel?.hideOverlap).toBe(true);
    // A crowded neighbour yields to the axis minimum and maximum, never the reverse.
    expect(y.axisLabel?.showMinLabel).toBe(true);
    expect(y.axisLabel?.showMaxLabel).toBe(true);
  });

  it("a cap of 1 caps at one split and keeps the axis min and max labelled", () => {
    const y = yAxisOf(build("bar", BAR, { cap: 1 }));
    expect(y.splitNumber).toBe(1);
    expect(y.axisLabel?.showMinLabel).toBe(true);
    expect(y.axisLabel?.showMaxLabel).toBe(true);
    expect(y.axisLabel?.hideOverlap).toBe(true);
  });

  it.each([
    ["bar", "bar" as const, BAR, undefined],
    ["histogram", "histogram" as const, HIST, undefined],
    ["time-axis line", "line" as const, TIME, { day: "timestamp" }],
  ])("%s: no cap (a >=180px canvas) builds the same option as before", (_n, type, mapping, ft) => {
    const without = build(type, mapping, { cap: undefined, fieldTypes: ft, compact: false });
    expect(yAxisOf(without).splitNumber).toBeUndefined();
    expect(yAxisOf(without).axisLabel?.hideOverlap).toBeUndefined();
    const legacy = buildChartOption({
      appearance: {
        background: "transparent",
        color: "inherit",
        transparency: 0,
        chart: { ...defaultChartAppearance, chartType: type },
      },
      rawRows: rows,
      headers,
      fieldMapping: mapping,
      fieldTypes: ft,
      effectiveCompact: false,
      measuredPieLegendOverlap: false,
      themeTokens: tokens,
      theme: "light",
    });
    // Formatter functions are fresh closures per build, so compare the serialisable option.
    expect(JSON.parse(JSON.stringify(without))).toEqual(JSON.parse(JSON.stringify(legacy)));
  });

  it("leaves a horizontal bar (category y axis) untouched", () => {
    const y = yAxisOf(
      build("bar", BAR, { cap: 1, chartOptions: { bar: { orientation: "horizontal" } } }),
    );
    expect(y.type).toBe("category");
    expect(y.splitNumber).toBeUndefined();
  });

  it("leaves a heatmap (category y axis) and a pie untouched", () => {
    const heat = build("heatmap", { xAxis: "region", series: "day", yAxis: "revenue" }, { cap: 1 });
    expect(yAxisOf(heat).splitNumber).toBeUndefined();
    const pie = build("pie", { xAxis: "region", yAxis: "revenue" }, { cap: 1 });
    expect(pie.yAxis).toBeUndefined();
  });
});
