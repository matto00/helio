// zrender's `lib/` is ESM-only under Jest; its UMD bundle exposes the same `color.parse` the
// visualMap uses to read an `inRange` colour.
const { color: zrenderColor } = require("zrender/dist/zrender.js") as {
  color: { parse: (c: string) => number[] | null };
};
const parse = zrenderColor.parse;

import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartThemeTokens } from "../../../utils/chartAppearance";
import type { ChartType } from "../../../utils/chartAppearance";
import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import { buildChartOption } from "./buildChartOption";
import { buildDataOption, withPointerCursor } from "./chartDataOptions";

const themeTokens: ChartThemeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: "#abcdef",
  fontSans: "Inter, sans-serif",
  fontMono: "ui-monospace, monospace",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
  radiusMd: "8px",
  accentStrong: "#ea580c",
  accent: "#ea580c",
  textMuted: "#778899",
};

const headers = ["day", "test", "failures", "ms"];
const heatRows = [
  ["Mon", "testA", "2", "10"],
  ["Mon", "testA", "3", "20"],
  ["Mon", "testB", "1", "30"],
  ["Tue", "testA", "n/a", "40"],
  ["Tue", "testB", "4", "50"],
];

/** Series that actually plot something (the option always carries a data-less placeholder series). */
function plotted(option: { series?: unknown }): Array<{ type: string; data?: unknown[] }> {
  return (option.series as Array<{ type: string; data?: unknown[] }>).filter(
    (s) => Array.isArray(s.data) && s.data.length > 0,
  );
}

function build(
  chartType: ChartType,
  fieldMapping: Record<string, string>,
  opts: {
    rows?: string[][];
    chartOptions?: ChartTypeOptionsMap;
    compact?: boolean;
    theme?: "dark" | "light";
  } = {},
) {
  const appearance: PanelAppearance = {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    chart: { ...defaultChartAppearance, chartType },
  };
  return buildChartOption({
    appearance,
    rawRows: opts.rows ?? heatRows,
    headers,
    fieldMapping,
    chartOptions: opts.chartOptions,
    effectiveCompact: opts.compact ?? false,
    measuredPieLegendOverlap: false,
    themeTokens,
    theme: opts.theme ?? "dark",
  });
}

const heatMapping = { xAxis: "day", series: "test", yAxis: "failures" };

describe("buildChartOption heatmap (HEL-1311)", () => {
  it("plots a category x category matrix with summed cells and first-appearance order", () => {
    const option = build("heatmap", heatMapping);
    expect((option.xAxis as { data: string[] }).data).toEqual(["Mon", "Tue"]);
    const yAxis = option.yAxis as { type: string; data: string[]; axisLabel: object };
    expect(yAxis.type).toBe("category");
    expect(yAxis.data).toEqual(["testA", "testB"]);
    // The appearance's number formatter must not survive onto the category axis.
    expect(yAxis.axisLabel).not.toHaveProperty("formatter");
    const series = option.series as Array<{ type: string; data: number[][] }>;
    expect(series[0].type).toBe("heatmap");
    // Mon/testA = 2 + 3; Mon/testB = 1; Tue/testB = 4; Tue/testA (n/a only) is omitted.
    expect(series[0].data).toEqual([
      [0, 0, 5],
      [0, 1, 1],
      [1, 1, 4],
    ]);
  });

  it("adds a continuous visualMap spanning the plotted min..max with no drag handles", () => {
    const visualMap = build("heatmap", heatMapping).visualMap as {
      type: string;
      min: number;
      max: number;
      calculable: boolean;
      inRange: { color: string[] };
      textStyle: { color: string };
      text: string[];
    };
    expect(visualMap.type).toBe("continuous");
    expect([visualMap.min, visualMap.max]).toEqual([1, 5]);
    expect(visualMap.calculable).toBe(false);
    // accent at the 0.25 alpha floor -> full accent
    expect(visualMap.inRange.color).toEqual(["rgba(234, 88, 12, 0.25)", "#ea580c"]);
    expect(visualMap.text).toEqual(["5", "1"]);
    expect(visualMap.textStyle.color).toBe("#abcdef");
  });

  it.each(["dark", "light"] as const)(
    "paints the legend bar's out-of-range layer transparent so the legend and the cells blend over the same surface (%s)",
    (theme) => {
      const visualMap = build("heatmap", heatMapping, { theme }).visualMap as {
        outOfRange?: { color?: string[] };
      };
      // ECharts draws an `inactiveColor` (grey) bar UNDER the gradient unless outOfRange is set; the
      // 0.25-alpha low stop would then blend over grey in the legend but over the card in the cells.
      expect(visualMap.outOfRange?.color).toHaveLength(1);
      expect(parse(visualMap.outOfRange!.color![0])![3]).toBe(0);
    },
  );

  it("uses only colours zrender can parse (a black fallback would hide the scale)", () => {
    const visualMap = build("heatmap", heatMapping).visualMap as { inRange: { color: string[] } };
    for (const colour of visualMap.inRange.color) expect(parse(colour)).not.toBeNull();
  });

  it.each([
    ["xAxis", { series: "test", yAxis: "failures" }],
    ["series", { xAxis: "day", yAxis: "failures" }],
    ["yAxis", { xAxis: "day", series: "test" }],
    ["an unknown column", { xAxis: "day", series: "nope", yAxis: "failures" }],
  ])("renders no cells when %s is unmapped", (_name, mapping) => {
    const option = build("heatmap", mapping);
    expect(plotted(option)).toEqual([]);
    expect(option.visualMap).toBeUndefined();
  });

  it("omits the heatmap series when no cell has a numeric value", () => {
    const rows = [["Mon", "testA", "n/a", "1"]];
    expect(plotted(build("heatmap", heatMapping, { rows }))).toEqual([]);
  });

  it("keeps the colour-scale room under the grid in compact mode", () => {
    const grid = build("heatmap", heatMapping, { compact: true }).grid as { bottom: number };
    expect(grid.bottom).toBeGreaterThan(8);
  });

  it("escapes row and column names in the tooltip", () => {
    const rows = [["<b>x</b>", "a&b", "3", "1"]];
    const option = build("heatmap", heatMapping, { rows });
    const formatter = (option.tooltip as { formatter: (p: unknown) => string }).formatter;
    const html = formatter({ value: [0, 0, 3] });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("a&amp;b");
  });
});

describe("buildChartOption histogram (HEL-1311)", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ["d", "t", "1", String(i)]);

  it("bins the numeric xAxis field into touching bars labelled with ranges", () => {
    const option = build("histogram", { xAxis: "ms" }, { rows });
    const series = option.series as Array<{
      type: string;
      data: number[];
      barCategoryGap: number;
      cursor: string;
    }>;
    expect(series[0].type).toBe("bar");
    expect(series[0].barCategoryGap).toBe(0);
    expect(series[0].data.reduce((a, b) => a + b, 0)).toBe(10);
    expect((option.xAxis as { data: string[] }).data).toHaveLength(series[0].data.length);
  });

  it("honours chartOptions.histogram.binCount", () => {
    const option = build(
      "histogram",
      { xAxis: "ms" },
      { rows, chartOptions: { histogram: { binCount: 3 } } },
    );
    expect((option.series as Array<{ data: number[] }>)[0].data).toHaveLength(3);
  });

  it("renders empty with no xAxis mapping (never column 0)", () => {
    expect(plotted(build("histogram", {}, { rows }))).toEqual([]);
  });

  it("does not advertise bars as clickable", () => {
    const series = buildDataOption(rows, headers, { xAxis: "ms" }, "histogram").series as Array<{
      cursor: string;
    }>;
    expect(series[0].cursor).toBe("default");
    const bar = withPointerCursor({ series: [{ type: "bar" }] }, "bar").series as Array<{
      cursor: string;
    }>;
    expect(bar[0].cursor).toBe("pointer");
  });
});
