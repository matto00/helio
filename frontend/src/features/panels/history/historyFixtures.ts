import type { HistoryPoint, OutputHistory } from "./outputHistoryService";

export const HEAD_AT = "2026-10-05T10:00:00Z";
export const BASE_AT = "2026-09-28T09:00:00Z";

export function metricPoint(
  capturedAt: string,
  value: number | null,
  metric: { field?: string; agg?: string | null } = {},
): HistoryPoint {
  return {
    capturedAt,
    rowCount: 10,
    summary: {
      metric: { field: metric.field ?? "amount", agg: metric.agg ?? "sum", value },
    },
  };
}

/** A 7d history: 1075 a week ago, 1204 now, three sparkline points. */
export function makeHistory(overrides: Partial<OutputHistory> = {}): OutputHistory {
  const midAt = "2026-10-01T10:00:00Z";
  return {
    compare: "7d",
    current: { capturedAt: HEAD_AT, rowCount: 10, value: 1204 },
    baseline: { capturedAt: BASE_AT, rowCount: 10, value: 1075 },
    delta: 129,
    pct: 12.0,
    availableFrom: null,
    sparkline: [
      { capturedAt: BASE_AT, value: 1075 },
      { capturedAt: midAt, value: 1100 },
      { capturedAt: HEAD_AT, value: 1204 },
    ],
    points: [metricPoint(HEAD_AT, 1204), metricPoint(midAt, 1100), metricPoint(BASE_AT, 1075)],
    ...overrides,
  };
}

/** The shape the Output editor actually writes for an aggregated metric: the field lives in
 *  `aggregation.value` and `fieldMapping` carries no `value` slot (C6). */
export const METRIC_CONFIG = {
  fieldMapping: {},
  aggregation: { value: "amount", agg: "sum" },
  format: "integer",
  compare: "7d",
};
