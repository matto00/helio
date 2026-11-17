import { defaultPanelAppearance } from "../../../theme/appearance";
import {
  chartRenderInputs,
  keyAggregate,
  latestYAggregate,
  metricLoadedValue,
  recordsToPanelRows,
} from "./outputRenderInputs";

const RECORDS = [
  { region: "east", amount: 10 },
  { region: "east", amount: 5 },
  { region: "west", amount: 7 },
  { region: null, amount: 2 },
];

describe("recordsToPanelRows", () => {
  it("is the usePanelData grid: first record's key order, a missing cell as empty text", () => {
    expect(recordsToPanelRows(RECORDS)).toEqual({
      headers: ["region", "amount"],
      rawRows: [
        ["east", "10"],
        ["east", "5"],
        ["west", "7"],
        ["", "2"],
      ],
    });
  });

  it("is null for no records", () => {
    expect(recordsToPanelRows([])).toEqual({ headers: null, rawRows: null });
    expect(recordsToPanelRows(null)).toEqual({ headers: null, rawRows: null });
  });
});

describe("metricLoadedValue", () => {
  const config = { aggregation: { value: "amount", agg: "sum" } };

  it("aggregates the resolved field over the records", () => {
    expect(metricLoadedValue(config, RECORDS, null, null)).toBe("24");
  });

  it("falls back to the first row's cell without an aggregation", () => {
    const { headers, rawRows } = recordsToPanelRows(RECORDS);
    expect(metricLoadedValue({ fieldMapping: { value: "amount" } }, null, rawRows, headers)).toBe(
      "10",
    );
  });

  it("is empty when no field resolves", () => {
    expect(metricLoadedValue({}, RECORDS, null, null)).toBe("");
  });
});

describe("keyAggregate", () => {
  it("is a metric's resolved field and aggregation", () => {
    expect(
      keyAggregate("metric", { aggregation: { value: "amount", agg: "avg" } }, RECORDS),
    ).toEqual({
      label: "AVG AMOUNT",
      value: 6,
    });
  });

  it("is an aggregated chart's y field and aggregation", () => {
    const config = {
      chartType: "bar",
      aggregation: { groupBy: "region", agg: "max", yField: "amount" },
    };
    expect(keyAggregate("chart", config, RECORDS)).toEqual({ label: "MAX AMOUNT", value: 10 });
  });

  it("is null for an unaggregated chart, a table and no records", () => {
    expect(keyAggregate("chart", { chartType: "line" }, RECORDS)).toBeNull();
    expect(keyAggregate("table", {}, RECORDS)).toBeNull();
    expect(
      keyAggregate("metric", { aggregation: { value: "amount", agg: "sum" } }, null),
    ).toBeNull();
  });
});

describe("chartRenderInputs", () => {
  const config = {
    chartType: "bar",
    fieldMapping: { xAxis: "region", yAxis: "amount" },
    aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
  };

  it("takes the Output's own chart type and groups the records", () => {
    const inputs = chartRenderInputs({
      config,
      appearance: defaultPanelAppearance,
      records: RECORDS,
    });
    expect(inputs.appearance.chart?.chartType).toBe("bar");
    expect(inputs.chartAggregate?.seriesName).toBe("sum(amount)");
    expect(inputs.aggregationSpec).toMatchObject({ groupBy: "region", groupHasNull: true });
    expect(inputs.fieldMapping).toEqual({ xAxis: "region", yAxis: "amount" });
  });

  it("does not aggregate a scatter", () => {
    const inputs = chartRenderInputs({
      config: { ...config, chartType: "scatter" },
      appearance: defaultPanelAppearance,
      records: RECORDS,
    });
    expect(inputs.chartAggregate).toBeNull();
    expect(inputs.aggregationSpec).toBeNull();
  });
});

describe("recordsToPanelRows with a column order (HEL-1705 H)", () => {
  it("takes the headers from `columns` and reads each cell by header, so an integer-like key keeps its place", () => {
    const record = { "10": "ten", alpha: "a", zeta: "z" };
    expect(Object.keys(record)[0]).toBe("10");
    expect(recordsToPanelRows([record], ["zeta", "10", "alpha"])).toEqual({
      headers: ["zeta", "10", "alpha"],
      rawRows: [["z", "ten", "a"]],
    });
  });

  it("without `columns` keeps the first record's key order, and a missing cell is empty", () => {
    expect(recordsToPanelRows([{ b: 1, a: 2 }, { b: 3 }]).rawRows).toEqual([
      ["1", "2"],
      ["3", ""],
    ]);
  });
});

describe("latestYAggregate (HEL-1705 D5)", () => {
  const SCHEMA = [
    { name: "t", type: "timestamp" },
    { name: "y", type: "float" },
  ];
  const LINE = { chartType: "line", fieldMapping: { xAxis: "t", yAxis: "y" } };
  // Record order is NOT time order: the latest instant is the FIRST record.
  const UNORDERED = [
    { t: "2026-01-03T00:00:00Z", y: 30 },
    { t: "2026-01-01T00:00:00Z", y: 10 },
    { t: "2026-01-02T00:00:00Z", y: 20 },
  ];

  it("is the y at the last point in the order the chart plots, not the last record", () => {
    expect(latestYAggregate("chart", LINE, SCHEMA, UNORDERED)).toEqual({
      label: "LATEST Y",
      value: 30,
    });
    expect(latestYAggregate("chart", { ...LINE, chartType: "bar" }, SCHEMA, UNORDERED)?.value).toBe(
      30,
    );
  });

  it("is the last record when the chart plots records in order (no timestamp x)", () => {
    const rows = [
      { c: "a", y: 1 },
      { c: "b", y: 2 },
    ];
    expect(
      latestYAggregate(
        "chart",
        { chartType: "line", fieldMapping: { xAxis: "c", yAxis: "y" } },
        null,
        rows,
      )?.value,
    ).toBe(2);
  });

  it("walks back over a last point with no numeric y", () => {
    const rows = [
      { t: "2026-01-01T00:00:00Z", y: 10 },
      { t: "2026-01-02T00:00:00Z", y: null },
      { t: "2026-01-03T00:00:00Z", y: "n/a" },
    ];
    expect(latestYAggregate("chart", LINE, SCHEMA, rows)?.value).toBe(10);
  });

  it("is absent when no point has a numeric y, and with no rows", () => {
    expect(
      latestYAggregate("chart", LINE, SCHEMA, [{ t: "2026-01-01T00:00:00Z", y: null }]),
    ).toBeNull();
    expect(latestYAggregate("chart", LINE, SCHEMA, [])).toBeNull();
    expect(latestYAggregate("chart", LINE, SCHEMA, null)).toBeNull();
  });

  it.each([
    ["a pie chart", { ...LINE, chartType: "pie" }],
    ["a scatter chart", { ...LINE, chartType: "scatter" }],
    ["a heatmap", { ...LINE, chartType: "heatmap" }],
    ["a histogram", { ...LINE, chartType: "histogram" }],
    [
      "a chart with a series field",
      { ...LINE, fieldMapping: { ...LINE.fieldMapping, series: "t" } },
    ],
    ["an aggregated chart", { ...LINE, aggregation: { groupBy: "t", agg: "sum", yField: "y" } }],
    ["a chart with no y mapped", { chartType: "line", fieldMapping: { xAxis: "t" } }],
    ["a chart with no x mapped", { chartType: "line", fieldMapping: { yAxis: "y" } }],
  ])("is absent for %s", (_name, config) => {
    expect(latestYAggregate("chart", config, SCHEMA, UNORDERED)).toBeNull();
  });

  it("is absent for a non-chart kind", () => {
    expect(latestYAggregate("table", LINE, SCHEMA, UNORDERED)).toBeNull();
  });
});
