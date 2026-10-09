import {
  buildAggregateTailConfigs,
  buildOutputConfig,
  type BuildOutputConfigParams,
} from "./buildOutputConfig";

function boundOrLiteral(overrides: Partial<BuildOutputConfigParams["annotationState"]> = {}) {
  return {
    mode: "field" as const,
    setMode: jest.fn(),
    fieldValue: "",
    setFieldValue: jest.fn(),
    literalValue: "",
    setLiteralValue: jest.fn(),
    dirty: false,
    reset: jest.fn(),
    patchValue: undefined,
    fieldMappingValue: undefined,
    ...overrides,
  };
}

function baseParams(overrides: Partial<BuildOutputConfigParams> = {}): BuildOutputConfigParams {
  return {
    kind: "chart",
    chartType: "line",
    chartFieldMapping: {},
    groupBy: "",
    chartAggFn: "",
    yField: "",
    chartOptionsState: {},
    annotationState: boundOrLiteral(),
    tableFieldMapping: {},
    tableColumnOrder: undefined,
    tableColumnFormats: {},
    metricField: "",
    metricAggFn: "",
    metricLabelState: boundOrLiteral(),
    metricUnitState: boundOrLiteral(),
    metricFormat: "number",
    compare: "none",
    markdownContent: "",
    collectionFieldMapping: {},
    collectionFormat: "number",
    timelineFieldMapping: {},
    ...overrides,
  };
}

describe("buildOutputConfig", () => {
  it("builds a chart config with aggregation when groupBy/yField/aggFn are all set", () => {
    const config = buildOutputConfig(
      baseParams({ kind: "chart", groupBy: "region", chartAggFn: "sum", yField: "revenue" }),
    );
    expect(config.aggregation).toEqual({ groupBy: "region", agg: "sum", yField: "revenue" });
  });

  it("writes aggregation: null for a scatter chart even when groupBy/yField/aggFn are set (HEL-1313)", () => {
    const config = buildOutputConfig(
      baseParams({
        kind: "chart",
        chartType: "scatter",
        groupBy: "region",
        chartAggFn: "sum",
        yField: "revenue",
      }),
    );
    expect(config.aggregation).toBeNull();
    expect(config.chartType).toBe("scatter");
  });

  it("omits chart aggregation when any of groupBy/yField/aggFn is missing", () => {
    const config = buildOutputConfig(baseParams({ kind: "chart", groupBy: "region" }));
    expect(config.aggregation).toBeNull();
  });

  it("writes a literal chart annotation and clears any field binding", () => {
    const config = buildOutputConfig(
      baseParams({
        kind: "chart",
        annotationState: boundOrLiteral({ mode: "literal", literalValue: "Q3 totals" }),
      }),
    );
    expect(config.annotation).toBe("Q3 totals");
    expect((config.fieldMapping as Record<string, string>).annotation).toBeUndefined();
  });

  it("metric config writes fieldMapping.value with or without a reduce function (HEL-1389 D4a)", () => {
    const unreduced = buildOutputConfig(baseParams({ kind: "metric", metricField: "amount" }));
    expect((unreduced.fieldMapping as Record<string, string>).value).toBe("amount");
    expect(unreduced.aggregation).toBeNull();

    const reduced = buildOutputConfig(
      baseParams({ kind: "metric", metricField: "amount", metricAggFn: "sum" }),
    );
    expect((reduced.fieldMapping as Record<string, string>).value).toBe("amount");
    expect(reduced.aggregation).toEqual({ value: "amount", agg: "sum" });
  });

  it("metric label/unit are an explicit null in field mode or when the literal is emptied (HEL-1389)", () => {
    const fieldMode = buildOutputConfig(
      baseParams({
        kind: "metric",
        metricLabelState: boundOrLiteral({
          mode: "field",
          fieldValue: "lbl",
          fieldMappingValue: "lbl",
        }),
        metricUnitState: boundOrLiteral({ mode: "literal", literalValue: "" }),
      }),
    );
    expect(fieldMode.label).toBeNull();
    expect(fieldMode.unit).toBeNull();
    expect(fieldMode.fieldMapping).toEqual({ label: "lbl" });

    const literal = buildOutputConfig(
      baseParams({
        kind: "metric",
        metricLabelState: boundOrLiteral({ mode: "literal", literalValue: "Revenue" }),
      }),
    );
    expect(literal.label).toBe("Revenue");
  });

  it("chart fieldMapping never inherits a stored annotation slot; a bound annotation re-adds it", () => {
    const stale = buildOutputConfig(
      baseParams({ kind: "chart", chartFieldMapping: { category: "a", annotation: "old" } }),
    );
    expect(stale.fieldMapping).toEqual({ category: "a" });

    const bound = buildOutputConfig(
      baseParams({
        kind: "chart",
        chartFieldMapping: { category: "a", annotation: "old" },
        annotationState: boundOrLiteral({ mode: "field", fieldValue: "n", fieldMappingValue: "n" }),
      }),
    );
    expect(bound.fieldMapping).toEqual({ category: "a", annotation: "n" });
  });

  it("metric config carries format (HEL-876) and rejects an unrecognized value", () => {
    const withFormat = buildOutputConfig(
      baseParams({ kind: "metric", metricField: "amount", metricFormat: "currency" }),
    );
    expect(withFormat.format).toBe("currency");

    const bogus = buildOutputConfig(
      baseParams({ kind: "metric", metricField: "amount", metricFormat: "not-a-format" }),
    );
    expect(bogus.format).toBeNull();
  });

  it("collection config carries format (HEL-876)", () => {
    const config = buildOutputConfig(
      baseParams({ kind: "collection", collectionFormat: "percent" }),
    );
    expect(config.format).toBe("percent");
  });

  it("markdown config writes the literal content with an empty fieldMapping", () => {
    const config = buildOutputConfig(
      baseParams({
        kind: "markdown",
        markdownContent: "# Hi",
      }),
    );
    expect(config.content).toBe("# Hi");
    expect(config.fieldMapping).toEqual({});
  });

  it("table config carries the resolved column order", () => {
    const config = buildOutputConfig(baseParams({ kind: "table", tableColumnOrder: ["b", "a"] }));
    expect(config.columnOrder).toEqual(["b", "a"]);
  });

  // HEL-469 task 1.5 — REGRESSION GUARD, mutation-failable: the minimal-patch
  // Save body must carry `columnFormats` alongside `fieldMapping`/
  // `columnOrder` and NOTHING else, so a caller relying on `mergeConfig`'s
  // shallow merge (design D1a) never accidentally wipes `columnSort`/
  // `columnFilters` (both absent from this object entirely, on purpose —
  // they are never rebuilt by this editor). Mutate `buildOutputConfig`'s
  // "table" case to drop `columnFormats` from the returned object and this
  // assertion goes red.
  it("table config's Save body carries exactly fieldMapping/columnOrder/columnFormats", () => {
    const config = buildOutputConfig(
      baseParams({
        kind: "table",
        tableFieldMapping: { a: "a" },
        tableColumnOrder: ["a"],
        tableColumnFormats: { a: { type: "currency" } },
      }),
    );
    expect(Object.keys(config).sort()).toEqual(["columnFormats", "columnOrder", "fieldMapping"]);
    expect(config.columnFormats).toEqual({ a: { type: "currency" } });
  });

  // HEL-469 design D3b — clearing every column's format must still emit the
  // key as an EMPTY object, never omit it, so a Save is a whole-key replace
  // rather than leaving a stale entry in place under `mergeConfig`'s
  // shallow merge.
  it("table config emits an empty columnFormats object when no column is formatted", () => {
    const config = buildOutputConfig(baseParams({ kind: "table", tableColumnFormats: {} }));
    expect(config.columnFormats).toEqual({});
    expect("columnFormats" in config).toBe(true);
  });
});

// HEL-1390 -- "Add as tail with aggregate" must write fieldMapping keys that
// are real slots of the Output kind. The slot sets below mirror the backend's
// OutputBindingSpec.Chart / OutputBindingSpec.Metric (the frontend has no
// shared constant; capabilities supply slots at runtime), and the backend
// 400s any other key (OutputConfigValidation.validateFieldMapping).
const CHART_SLOTS = ["xAxis", "yAxis", "series", "annotation"];
const METRIC_SLOTS = ["value", "label", "unit"];

describe("buildAggregateTailConfigs (HEL-1390)", () => {
  it("chart tail writes fieldMapping { xAxis: groupBy, yAxis: alias } using only chart slots", () => {
    const result = buildAggregateTailConfigs(
      baseParams({ kind: "chart", groupBy: "region", chartAggFn: "sum", yField: "revenue" }),
      undefined,
    );
    const fieldMapping = result?.outputConfig.fieldMapping as Record<string, string>;
    expect(fieldMapping).toEqual({ xAxis: "region", yAxis: "sum_revenue" });
    for (const key of Object.keys(fieldMapping)) expect(CHART_SLOTS).toContain(key);
  });

  it("metric tail writes only metric slots", () => {
    const result = buildAggregateTailConfigs(
      baseParams({ kind: "metric", metricField: "signups", metricAggFn: "sum" }),
      undefined,
    );
    const fieldMapping = result?.outputConfig.fieldMapping as Record<string, string>;
    expect(fieldMapping).toEqual({ value: "sum_signups" });
    for (const key of Object.keys(fieldMapping)) expect(METRIC_SLOTS).toContain(key);
  });
});
