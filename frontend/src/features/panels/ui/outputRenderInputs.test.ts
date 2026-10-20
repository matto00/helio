import { defaultPanelAppearance } from "../../../theme/appearance";
import {
  chartRenderInputs,
  keyAggregate,
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
