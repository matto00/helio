import { HEAD_AT, BASE_AT, METRIC_CONFIG, makeHistory, metricPoint } from "./historyFixtures";
import {
  compareLabel,
  resolveServerMetricField,
  selectMetricHistoryView,
} from "./metricHistoryView";

describe("resolveServerMetricField (mirrors OutputSummaryReducer.metricField)", () => {
  it("never picks a lone label or unit mapping (HEL-1326)", () => {
    expect(resolveServerMetricField({ fieldMapping: { label: "name" } })).toBeNull();
    expect(
      resolveServerMetricField({ fieldMapping: { unit: "ccy" }, aggregation: { agg: "sum" } }),
    ).toBeNull();
  });
  it("aggregates aggregation.value for the {label} + aggregation shape", () => {
    expect(
      resolveServerMetricField({
        fieldMapping: { label: "name" },
        aggregation: { value: "amount", agg: "sum" },
      }),
    ).toEqual({ field: "amount", agg: "sum" });
  });
  it("falls back to fieldMapping.value, then aggregation.value, when several are mapped", () => {
    expect(resolveServerMetricField({ fieldMapping: { value: "a", label: "b" } })).toEqual({
      field: "a",
      agg: null,
    });
    expect(
      resolveServerMetricField({
        fieldMapping: { label: "b", unit: "c" },
        aggregation: { value: "z", agg: "sum" },
      }),
    ).toEqual({ field: "z", agg: "sum" });
  });
  it("is null with nothing to resolve", () => {
    expect(resolveServerMetricField({ fieldMapping: {} })).toBeNull();
  });
});

describe("compareLabel", () => {
  it.each([
    ["previous_run", "previous"],
    ["7d", "7d"],
    ["custom:P3D", "3d"],
    ["custom:PT6H", "6h"],
    ["custom:P1DT2H", "custom"],
  ])("%s -> %s", (compare, label) => {
    expect(compareLabel(compare)).toBe(label);
    expect(label).not.toMatch(/previous run/i);
  });
});

describe("selectMetricHistoryView", () => {
  it("returns headline, sparkline and an up delta for a matching history", () => {
    const view = selectMetricHistoryView(makeHistory(), METRIC_CONFIG, false);
    expect(view.headline).toBe(1204);
    expect(view.sparkline).toEqual([1075, 1100, 1204]);
    expect(view.comparison).toMatchObject({
      kind: "delta",
      direction: "up",
      pct: 12,
      label: "7d",
      baselineAt: BASE_AT,
      baselineValue: 1075,
    });
  });

  it("is empty with no history or no current point", () => {
    expect(selectMetricHistoryView(null, METRIC_CONFIG, false).headline).toBeNull();
    const none = selectMetricHistoryView(makeHistory({ current: null }), METRIC_CONFIG, false);
    expect(none).toEqual({ headline: null, sparkline: null, comparison: null });
  });

  it("falls back entirely when the head was computed under a different aggregation", () => {
    const view = selectMetricHistoryView(
      makeHistory(),
      { ...METRIC_CONFIG, aggregation: { value: "amount", agg: "avg" } },
      false,
    );
    expect(view).toEqual({ headline: null, sparkline: null, comparison: null });
  });

  it("drops older points from an earlier config and hides a delta against one of them", () => {
    const history = makeHistory({
      points: [
        metricPoint(HEAD_AT, 1204),
        metricPoint("2026-10-01T10:00:00Z", 1100),
        metricPoint(BASE_AT, 1075, { agg: "avg" }),
      ],
    });
    const view = selectMetricHistoryView(history, METRIC_CONFIG, false);
    expect(view.sparkline).toEqual([1100, 1204]);
    expect(view.comparison).toBeNull();
  });

  describe("baseline older than every returned point (HEL-1326 design D4)", () => {
    const OLD_AT = "2026-08-01T09:00:00Z";
    const outOfWindow = (metric?: { field: string; agg: string | null } | null) =>
      makeHistory({
        compare: "30d",
        baseline: {
          capturedAt: OLD_AT,
          rowCount: 10,
          value: 0,
          ...(metric === undefined ? {} : { metric }),
        },
        delta: 1204,
        pct: null,
      });
    const config = { ...METRIC_CONFIG, compare: "30d" };

    it("hides the delta when the baseline's own stored identity is another field", () => {
      const view = selectMetricHistoryView(
        outOfWindow({ field: "region", agg: "sum" }),
        config,
        false,
      );
      expect(view.headline).toBe(1204);
      expect(view.comparison).toBeNull();
    });

    it("hides the delta when the baseline's stored summary had no metric (null identity)", () => {
      expect(selectMetricHistoryView(outOfWindow(null), config, false).comparison).toBeNull();
    });

    it("GUARD: still shows the delta when the baseline identity matches the config", () => {
      const view = selectMetricHistoryView(
        outOfWindow({ field: "amount", agg: "sum" }),
        config,
        false,
      );
      expect(view.comparison).toMatchObject({ kind: "delta", direction: "up" });
    });

    it("GUARD: an older server's baseline without identity keeps today's behaviour", () => {
      expect(
        selectMetricHistoryView(outOfWindow(undefined), config, false).comparison,
      ).toMatchObject({
        kind: "delta",
      });
    });
  });

  it("renders no sparkline under two usable points and skips null values", () => {
    const history = makeHistory({
      sparkline: [
        { capturedAt: BASE_AT, value: null },
        { capturedAt: HEAD_AT, value: 1204 },
      ],
    });
    expect(selectMetricHistoryView(history, METRIC_CONFIG, false).sparkline).toBeNull();
  });

  it("direction: down, flat, and absolute-delta for a zero baseline", () => {
    const down = selectMetricHistoryView(
      makeHistory({ delta: -85, pct: -8.5 }),
      METRIC_CONFIG,
      false,
    );
    expect(down.comparison).toMatchObject({ direction: "down", pct: 8.5 });
    const flat = selectMetricHistoryView(makeHistory({ delta: 0, pct: 0 }), METRIC_CONFIG, false);
    expect(flat.comparison).toMatchObject({ direction: "flat" });
    const zero = selectMetricHistoryView(
      makeHistory({
        baseline: { capturedAt: BASE_AT, rowCount: 1, value: 0 },
        delta: 5,
        pct: null,
      }),
      METRIC_CONFIG,
      false,
    );
    expect(zero.comparison).toMatchObject({ direction: "up", pct: null, absDelta: 5 });
  });

  it("emits an available-from note for a missing baseline, and nothing without availableFrom", () => {
    const note = selectMetricHistoryView(
      makeHistory({
        baseline: null,
        delta: null,
        pct: null,
        availableFrom: "2026-10-12T09:00:00Z",
      }),
      METRIC_CONFIG,
      false,
    );
    expect(note.comparison).toEqual({
      kind: "availableFrom",
      label: "7d",
      availableFrom: "2026-10-12T09:00:00Z",
    });
    const nothing = selectMetricHistoryView(
      makeHistory({ baseline: null, delta: null, pct: null }),
      METRIC_CONFIG,
      false,
    );
    expect(nothing.comparison).toBeNull();
  });

  it("hides delta and sparkline when the config's compare differs from the cached one (absent == null)", () => {
    const stale = selectMetricHistoryView(
      makeHistory(),
      { ...METRIC_CONFIG, compare: "30d" },
      false,
    );
    expect(stale).toEqual({ headline: 1204, sparkline: null, comparison: null });
    const { compare: _omit, ...noCompare } = METRIC_CONFIG;
    void _omit;
    expect(selectMetricHistoryView(makeHistory(), noCompare, false).comparison).toBeNull();
    const absentIsNull = selectMetricHistoryView(makeHistory({ compare: null }), noCompare, false);
    expect(absentIsNull.headline).toBe(1204);
    expect(absentIsNull.sparkline).not.toBeNull();
  });

  it("no comparison when compare is null", () => {
    const view = selectMetricHistoryView(
      makeHistory({ compare: null }),
      { ...METRIC_CONFIG, compare: null },
      false,
    );
    expect(view.comparison).toBeNull();
    expect(view.headline).toBe(1204);
  });

  it("filtered: no headline/sparkline, a single filtered marker only when a comparison would show", () => {
    const view = selectMetricHistoryView(makeHistory(), METRIC_CONFIG, true);
    expect(view).toEqual({ headline: null, sparkline: null, comparison: { kind: "filtered" } });
    const quiet = selectMetricHistoryView(
      makeHistory({ compare: null, sparkline: [] }),
      METRIC_CONFIG,
      true,
    );
    expect(quiet.comparison).toBeNull();
  });
});

describe("resolveServerMetricField is independent of fieldMapping key order (HEL-1182)", () => {
  // Plain-object string keys iterate in insertion order. "value-first" is a baseline control (passes under a
  // positional pick too); the other three are non-value-first and go red under one.
  const mappings: Array<[string, Record<string, string>]> = [
    ["value-first (baseline control)", { value: "amount", label: "rank" }],
    ["label-first", { label: "rank", value: "amount" }],
    ["unit-first", { unit: "rank", value: "amount" }],
    ["unit+label-first", { unit: "rank", label: "region", value: "amount" }],
  ];

  it.each(mappings)("%s resolves the value column", (name, fieldMapping) => {
    if (!name.startsWith("value-first")) expect(Object.keys(fieldMapping)[0]).not.toBe("value");
    expect(resolveServerMetricField({ fieldMapping })).toEqual({ field: "amount", agg: null });
  });

  it.each(mappings)("%s keeps the aggregation identity", (_name, fieldMapping) => {
    expect(resolveServerMetricField({ fieldMapping, aggregation: { agg: "sum" } })).toEqual({
      field: "amount",
      agg: "sum",
    });
  });

  it.each(mappings)("%s: fieldMapping.value wins over aggregation.value", (_name, fieldMapping) => {
    expect(
      resolveServerMetricField({ fieldMapping, aggregation: { value: "other", agg: "max" } }),
    ).toEqual({ field: "amount", agg: "max" });
  });
});
