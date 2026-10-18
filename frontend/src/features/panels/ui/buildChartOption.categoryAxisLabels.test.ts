import { defaultChartAppearance } from "../../../theme/appearance";
import type { ChartThemeTokens, ChartType } from "../../../utils/chartAppearance";
import type { PanelAppearance } from "../types/panel";
import { buildChartOption } from "./buildChartOption";

const themeTokens: ChartThemeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: "#abcdef",
  fontSans: "Inter, sans-serif",
  fontMono: "ui-monospace, monospace",
  shadowSoft: "0 1px 2px rgba(0,0,0,0.1)",
  radiusMd: "8px",
  accentEmphasis: "#ea580c",
  accent: "#ea580c",
  textMuted: "#778899",
  success: "#4cc38a",
  warning: "#f5b944",
  error: "#f17b67",
};

const headers = ["day", "test", "failures", "ms"];
const rows = [
  ["Mon", "testA", "2", "10"],
  ["Tue", "testB", "4", "50"],
  ["Wed", "testA", "1", "90"],
];

interface Label {
  interval?: unknown;
  hideOverlap?: unknown;
  lineHeight?: number;
  textMargin?: number[];
  fontSize?: number;
}

function labels(chartType: ChartType, mapping: Record<string, string>, compact: boolean) {
  const appearance: PanelAppearance = {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    chart: { ...defaultChartAppearance, chartType },
  };
  const option = buildChartOption({
    appearance,
    rawRows: rows,
    headers,
    fieldMapping: mapping,
    effectiveCompact: compact,
    measuredPieLegendOverlap: false,
    themeTokens,
    theme: "light",
  });
  return {
    x: (option.xAxis as { axisLabel: Label }).axisLabel,
    y: (option.yAxis as { axisLabel: Label }).axisLabel,
  };
}

const heat = { xAxis: "day", series: "test", yAxis: "failures" };

describe("heatmap/histogram category axis labels (HEL-1512)", () => {
  it("heatmap x shows every label that fits with a font-relative margin (12px font)", () => {
    const { x } = labels("heatmap", heat, false);
    expect(x.interval).toBe(0);
    expect(x.hideOverlap).toBe(true);
    expect(x.lineHeight).toBe(15);
    expect(x.textMargin?.[0]).toBe(0);
    expect(x.textMargin?.[1]).toBeCloseTo(12 * 0.6, 5);
    expect(x.textMargin).toHaveLength(2);
  });

  it("heatmap y shows every label with an explicit line height and no extra margin", () => {
    const { y } = labels("heatmap", heat, false);
    expect(y.interval).toBe(0);
    expect(y.hideOverlap).toBe(true);
    expect(y.lineHeight).toBe(15);
    expect(y.textMargin).toBeUndefined();
  });

  it("histogram x shows every label with the font-relative margin", () => {
    const { x } = labels("histogram", { xAxis: "ms" }, false);
    expect(x.interval).toBe(0);
    expect(x.hideOverlap).toBe(true);
    expect(x.textMargin?.[1]).toBeCloseTo(7.2, 5);
  });

  it("compact path recomputes the margin and line height for the 10px font, not the 12px ones", () => {
    const { x, y } = labels("heatmap", heat, true);
    expect(x.fontSize).toBe(10);
    expect(x.textMargin?.[1]).toBeCloseTo(6, 5);
    expect(x.lineHeight).toBe(12);
    expect(y.lineHeight).toBe(12);
    expect(y.textMargin).toBeUndefined();
    const hist = labels("histogram", { xAxis: "ms" }, true).x;
    expect(hist.textMargin?.[1]).toBeCloseTo(6, 5);
    expect(hist.lineHeight).toBe(12);
  });

  it("leaves other chart types on ECharts' automatic interval and default margin", () => {
    const { x } = labels("bar", { xAxis: "day", yAxis: "failures" }, false);
    expect(x.interval).toBeUndefined();
    expect(x.hideOverlap).toBeUndefined();
    expect(x.textMargin).toBeUndefined();
    expect(x.lineHeight).toBeUndefined();
  });
});
