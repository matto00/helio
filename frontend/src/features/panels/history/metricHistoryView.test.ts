import { HEAD_AT, BASE_AT, METRIC_CONFIG, makeHistory, metricPoint } from "./historyFixtures";
import {
  compareLabel,
  resolveServerMetricField,
  selectMetricHistoryView,
} from "./metricHistoryView";

describe("resolveServerMetricField (mirrors OutputSummaryReducer.metric)", () => {
  it("uses the lone fieldMapping string", () => {
    expect(
      resolveServerMetricField({ fieldMapping: { x: "price" }, aggregation: { agg: "avg" } }),
    ).toEqual({ field: "price", agg: "avg" });
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
