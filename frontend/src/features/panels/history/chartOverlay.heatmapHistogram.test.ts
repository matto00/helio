import type { EChartsOption } from "echarts";

import { applyChartOverlay } from "../ui/chartOverlayOption";
import { chartAggregationSpec, chartCompareBlocker, selectChartOverlay } from "./chartOverlay";
import { makeHistory } from "./historyFixtures";

const themeTokens = {
  surfaceStrong: "#1a1d24",
  borderSubtle: "#d0d5dd",
  text: "#abcdef",
  fontSans: "Inter",
  fontMono: "mono",
  shadowSoft: "none",
  radiusMd: "8px",
  accentStrong: "#ea580c",
  accent: "#ea580c",
  textMuted: "#778899",
};

describe("heatmap/histogram never draw the vs overlay (HEL-1311)", () => {
  it.each(["heatmap", "histogram"])(
    "chartCompareBlocker names the chart type for %s, ahead of series/unmapped",
    (chartType) => {
      // A heatmap always maps `series`; the chartType reason must win over it.
      expect(
        chartCompareBlocker({
          chartType,
          fieldMapping: { xAxis: "day", series: "test", yAxis: "n" },
        }),
      ).toBe("chartType");
      expect(chartCompareBlocker({ chartType, fieldMapping: {} })).toBe("chartType");
    },
  );

  it("does not block a bar chart on its type", () => {
    expect(
      chartCompareBlocker({ chartType: "bar", fieldMapping: { xAxis: "a", yAxis: "b" } }),
    ).toBeNull();
  });

  it.each(["heatmap", "histogram"])("chartAggregationSpec is null for %s", (chartType) => {
    expect(
      chartAggregationSpec({
        chartType,
        aggregation: { groupBy: "a", agg: "sum", yField: "b" },
      }),
    ).toBeNull();
  });

  describe("selectChartOverlay", () => {
    const history = makeHistory({
      compare: "7d",
      baseline: {
        capturedAt: "2026-09-28T09:00:00Z",
        rowCount: 1,
        value: null,
        series: {
          mode: "rows",
          x: "day",
          y: "n",
          agg: null,
          downsampled: false,
          totalPoints: 1,
          points: [["Mon", 1]],
        },
      } as never,
    });
    const ctx = {
      filterActive: false,
      rowsTruncated: false,
      rawRows: [["Mon", "1"]],
      headers: ["day", "n"],
    };
    const cfg = (chartType: string) => ({
      chartType,
      compare: "7d",
      fieldMapping: { xAxis: "day", yAxis: "n" },
    });

    it("control: the same history and rows DO overlay a line chart", () => {
      expect(selectChartOverlay(history, cfg("line"), ctx)).not.toBeNull();
    });

    it.each(["heatmap", "histogram"])("returns no overlay for %s", (chartType) => {
      expect(selectChartOverlay(history, cfg(chartType), ctx)).toBeNull();
    });
  });

  it.each(["heatmap", "histogram"] as const)(
    "applyChartOverlay ignores a overlay on %s",
    (type) => {
      const option: EChartsOption = {
        xAxis: { type: "category", data: ["Mon"] },
        series: [{ type: "bar" }],
      };
      const overlay = { label: "vs 7d", points: [["Mon", 1]] as [unknown, number | null][] };
      expect(applyChartOverlay(option, type, undefined, overlay, themeTokens)).toBe(option);
    },
  );
});
