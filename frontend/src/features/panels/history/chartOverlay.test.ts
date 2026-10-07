import {
  chartCompareBlocker,
  selectChartOverlay,
  selectPointOverlay,
  type ChartOverlayContext,
} from "./chartOverlay";
import { BASE_AT, makeHistory } from "./historyFixtures";
import type { HistorySeries, OutputHistory } from "./outputHistoryService";

function series(overrides: Partial<HistorySeries> = {}): HistorySeries {
  return {
    mode: "rows",
    x: "day",
    y: "amount",
    agg: null,
    points: [
      ["Mon", 3],
      ["Tue", 4],
    ],
    totalPoints: 2,
    downsampled: false,
    ...overrides,
  };
}

function historyWith(s: HistorySeries | null, overrides: Partial<OutputHistory> = {}) {
  const h = makeHistory();
  return {
    ...h,
    baseline: { ...h.baseline!, series: s },
    ...overrides,
  } satisfies OutputHistory;
}

const config = { fieldMapping: { xAxis: "day", yAxis: "amount" }, compare: "7d" };
const ctx: ChartOverlayContext = {
  filterActive: false,
  rowsTruncated: false,
  rawRows: [
    ["Mon", "5"],
    ["Tue", "6"],
  ],
  headers: ["day", "amount"],
};

describe("selectChartOverlay", () => {
  it("returns the labelled baseline series when everything lines up", () => {
    expect(selectChartOverlay(historyWith(series()), config, ctx)).toEqual({
      label: "vs 7d",
      points: series().points,
    });
  });

  it("labels previous_run as 'vs previous', never 'previous run'", () => {
    const o = selectChartOverlay(
      historyWith(series(), { compare: "previous_run" }),
      { ...config, compare: "previous_run" },
      ctx,
    );
    expect(o?.label).toBe("vs previous");
    expect(o?.label).not.toMatch(/previous run/i);
  });

  it("uses the baseline capture date for a generic custom compare", () => {
    const cfg = { ...config, compare: "custom:P1W" };
    const o = selectChartOverlay(historyWith(series(), { compare: "custom:P1W" }), cfg, ctx);
    expect(o?.label.startsWith("vs ")).toBe(true);
    expect(o?.label).not.toBe("vs custom");
    expect(o?.label).toContain(new Date(BASE_AT).toLocaleString(undefined, { day: "numeric" }));
  });

  it("uses humanized custom labels", () => {
    const cfg = { ...config, compare: "custom:P3D" };
    expect(
      selectChartOverlay(historyWith(series(), { compare: "custom:P3D" }), cfg, ctx)?.label,
    ).toBe("vs 3d");
  });

  const cases: [string, OutputHistory | null, Record<string, unknown>, ChartOverlayContext][] = [
    ["no history", null, config, ctx],
    ["compare null", historyWith(series()), { fieldMapping: config.fieldMapping }, ctx],
    ["baseline null", historyWith(series(), { baseline: null }), config, ctx],
    ["series null", historyWith(null), config, ctx],
    ["downsampled", historyWith(series({ downsampled: true })), config, ctx],
    ["stale cached compare", historyWith(series(), { compare: "1d" }), config, ctx],
    ["filter active", historyWith(series()), config, { ...ctx, filterActive: true }],
    ["rows truncated", historyWith(series()), config, { ...ctx, rowsTruncated: true }],
    ["completeness unknown", historyWith(series()), config, { ...ctx, rowsTruncated: undefined }],
    ["y mismatch", historyWith(series({ y: "cost" })), config, ctx],
    ["x mismatch", historyWith(series({ x: "week" })), config, ctx],
    [
      "grouped mode",
      historyWith(series({ mode: "grouped", agg: "sum" })),
      { ...config, aggregation: { groupBy: "day", agg: "sum" } },
      ctx,
    ],
    [
      "repeated baseline x",
      historyWith(
        series({
          points: [
            ["Mon", 1],
            ["Mon", 2],
          ],
        }),
      ),
      config,
      ctx,
    ],
    [
      "repeated primary x",
      historyWith(series()),
      config,
      {
        ...ctx,
        rawRows: [
          ["Mon", "1"],
          ["Mon", "2"],
        ],
      },
    ],
    ["x column missing from headers", historyWith(series()), config, { ...ctx, headers: ["a"] }],
  ];
  it.each(cases)("returns null: %s", (_name, history, cfg, c) => {
    expect(selectChartOverlay(history, cfg, c)).toBeNull();
  });

  it("returns null for a grouped baseline matching an aggregation (dashboards plot rows)", () => {
    const grouped = series({ mode: "grouped", x: "day", y: "amount", agg: "sum" });
    expect(
      selectChartOverlay(
        historyWith(grouped),
        { ...config, aggregation: { groupBy: "day", yField: "amount", agg: "sum" } },
        ctx,
      ),
    ).toBeNull();
  });
});

describe("selectPointOverlay", () => {
  it("returns the comparison points with the supplied label", () => {
    const cmp = series({ points: [["Mon", 1]] });
    expect(selectPointOverlay(series(), cmp, "vs 5 Oct")).toEqual({
      label: "vs 5 Oct",
      points: cmp.points,
    });
  });

  it.each([
    ["mode", series({ mode: "grouped" })],
    ["x", series({ x: "week" })],
    ["y", series({ y: "cost" })],
    ["agg", series({ agg: "sum" })],
  ])("null on %s mismatch", (_n, other) => {
    expect(selectPointOverlay(series(), other, "vs")).toBeNull();
  });

  it("null when either series is null", () => {
    expect(selectPointOverlay(series(), null, "vs")).toBeNull();
    expect(selectPointOverlay(null, series(), "vs")).toBeNull();
  });

  it("null in rows mode when either side repeats an x; allowed in grouped mode", () => {
    const dup = series({
      points: [
        ["Mon", 1],
        ["Mon", 2],
      ],
    });
    expect(selectPointOverlay(dup, series(), "vs")).toBeNull();
    expect(selectPointOverlay(series(), dup, "vs")).toBeNull();
    const g = series({ mode: "grouped", agg: "sum" });
    expect(selectPointOverlay(g, g, "vs")).not.toBeNull();
  });

  it("allows downsampled series", () => {
    const d = series({ downsampled: true });
    expect(selectPointOverlay(d, d, "vs")).not.toBeNull();
  });
});

describe("chartCompareBlocker (HEL-1350)", () => {
  const clean = { fieldMapping: { xAxis: "day", yAxis: "amount" }, aggregation: null };
  it("is null for a clean raw-rows config, and ignores chartType alone", () => {
    expect(chartCompareBlocker(clean)).toBeNull();
    expect(chartCompareBlocker({ ...clean, chartType: "pie" })).toBeNull();
    expect(chartCompareBlocker({ ...clean, chartType: "scatter" })).toBeNull();
  });
  it.each([
    ["aggregated", { aggregation: { groupBy: "a", agg: "sum", yField: "b" } }],
    ["series", { fieldMapping: { xAxis: "day", yAxis: "amount", series: "r" } }],
    ["unmapped", { fieldMapping: { category: "a", value: "b" } }],
    ["unmapped", { fieldMapping: { xAxis: "day", yAxis: "" } }],
    ["horizontal", { chartOptions: { bar: { orientation: "horizontal" } } }],
    ["normalized", { chartOptions: { bar: { stacking: "normalized" } } }],
  ])("returns %s", (expected, patch) => {
    expect(chartCompareBlocker({ ...clean, ...patch })).toBe(expected);
  });
  it("returns the first blocker in order", () => {
    expect(
      chartCompareBlocker({
        fieldMapping: {},
        aggregation: { groupBy: "a" },
        chartOptions: { bar: { orientation: "horizontal" } },
      }),
    ).toBe("aggregated");
    expect(
      chartCompareBlocker({
        ...clean,
        chartOptions: { bar: { orientation: "horizontal", stacking: "normalized" } },
      }),
    ).toBe("horizontal");
  });
});
