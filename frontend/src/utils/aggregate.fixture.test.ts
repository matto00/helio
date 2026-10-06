import fs from "node:fs";
import path from "node:path";

import { computeAggregate, groupAndAggregate, type AggregatableRow } from "./aggregate";
import type { AggFn } from "../features/panels/types/panel";
import { resolveServerMetricField } from "../features/panels/history/metricHistoryView";

// The same fixture the backend `OutputSummaryReducerSeamSpec` reads (HEL-1271): the real functions
// here are the oracle, so the backend port must reproduce every `expected` value below.
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../shared-test-fixtures/output-summary-reducer.json",
);

interface CoerceCase {
  name: string;
  value?: unknown;
  absent?: boolean;
  expected: number | null;
}
interface AggregateCase {
  name: string;
  rows: AggregatableRow[];
  field: string;
  agg: AggFn;
  expected: number | null;
}
interface GroupCase {
  name: string;
  rows: AggregatableRow[];
  groupBy: string;
  agg: AggFn;
  yField: string;
  expected: { categories: string[]; values: number[] };
}
interface MetricFieldCase {
  name: string;
  config: Record<string, unknown>;
  expected: { field: string; agg: string | null } | null;
}
interface Fixture {
  coerce: CoerceCase[];
  aggregate: AggregateCase[];
  group: GroupCase[];
  metricField: MetricFieldCase[];
}

const fixture: Fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

describe("output-summary-reducer shared fixture", () => {
  // `coerceNumber` is not exported, so each case goes through `max`, which returns null exactly
  // when nothing coerces (`sum` would return 0 for both "not coercible" and "coerced to 0").
  it.each(fixture.coerce)("coerce: $name", (c) => {
    const rows: AggregatableRow[] = c.absent ? [{}] : [{ f: c.value }];
    expect(computeAggregate(rows, "f", "max")).toBe(c.expected);
  });

  it.each(fixture.aggregate)("aggregate: $name", (c) => {
    expect(computeAggregate(c.rows, c.field, c.agg)).toBe(c.expected);
  });

  it.each(fixture.group)("group: $name", (c) => {
    expect(groupAndAggregate(c.rows, c.groupBy, c.agg, c.yField)).toEqual(c.expected);
  });

  it.each(fixture.metricField)("metricField: $name", (c) => {
    expect(resolveServerMetricField(c.config)).toEqual(c.expected);
  });
});
