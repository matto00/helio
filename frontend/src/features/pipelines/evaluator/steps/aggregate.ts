// HEL-1581 — groupby, aggregate and pivot (ports of the same-named Scala steps). All three group with
// Scala's `groupBy`, so their output rows come in `immutable.HashMap` order (see ../scalaGroup.ts).

import {
  StepConfigError,
  asObject,
  missingRequired,
  optNumber,
  readObject,
  reqString,
  str,
  stringArray,
  typedArray,
} from "../config";
import { KeyBuilder, scalaGroupBy, scalaGroupByValue } from "../scalaGroup";
import { anyToString, cell, long, put, type Row, type Value } from "../value";
import { maxOf, minOf, sortedDoubles, sum, toDouble } from "./numeric";
import type { StepHandler } from "./types";

const numbersOf = (rows: readonly Row[], field: string): number[] => {
  const out: number[] = [];
  for (const row of rows) {
    const d = toDouble(cell(row, field));
    if (d !== undefined) out.push(d);
  }
  return out;
};

const nonNullCount = (rows: readonly Row[], field: string): number =>
  rows.reduce((n, row) => (cell(row, field) !== null ? n + 1 : n), 0);

// --- groupby -----------------------------------------------------------------------------------------

interface GroupByConfig {
  groupBy: string[];
  aggColumn: string;
  aggFunction: string;
}

export const groupByHandler: StepHandler<GroupByConfig> = {
  stepClass: "client",
  decode(raw) {
    const obj = asObject(raw);
    return {
      groupBy: stringArray(obj, "groupBy"),
      aggColumn: str(obj, "aggColumn", ""),
      aggFunction: str(obj, "aggFunction", "sum"),
    };
  },
  problems: () => [],
  apply(rows, { groupBy, aggColumn, aggFunction }, ctx) {
    const listFrame = ctx.listFrame === true;
    const fn = aggFunction.toLowerCase();
    const outputCol = `${fn}_${aggColumn}`;
    if (fn !== "sum" && fn !== "count") {
      throw new StepConfigError(`Unsupported aggregation function: ${fn}. Supported: sum, count`);
    }
    return scalaGroupBy(rows, (row) => groupBy.map((c) => cell(row, c))).map((group): Row => {
      const out: Record<string, Value> = {};
      groupBy.forEach((c, i) => put(out, c, group.keyValues[i]));
      put(
        out,
        outputCol,
        fn === "sum"
          ? sum(numbersOf(group.items, aggColumn), listFrame)
          : long(nonNullCount(group.items, aggColumn)),
      );
      return out;
    });
  },
};

// --- aggregate ---------------------------------------------------------------------------------------

interface Aggregation {
  alias: string;
  fn: string;
  field: string;
  p: number | undefined;
}

interface AggregateConfig {
  groupBy: string[];
  aggregations: Aggregation[];
}

const AGG_FUNCTIONS = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "median",
  "percentile",
  "count_distinct",
];

function aggregationProblem(agg: Aggregation): string | undefined {
  const fn = agg.fn.toLowerCase();
  if (!AGG_FUNCTIONS.includes(fn))
    return `Unsupported aggregation function: '${fn}'. Supported: ${AGG_FUNCTIONS.join(", ")}`;
  if (fn === "percentile") {
    if (agg.p === undefined) return "percentile requires 'p' (0-100)";
    if (Number.isNaN(agg.p) || !Number.isFinite(agg.p) || agg.p < 0 || agg.p > 100) {
      return `percentile 'p' must be between 0 and 100, got ${agg.p}`;
    }
    return undefined;
  }
  return agg.p !== undefined ? `'p' is only valid for percentile, not '${fn}'` : undefined;
}

/** `percentile_cont` over ascending, NaN-free values; `p` is 0-100. */
function percentileOf(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const h = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const vl = sorted[lo];
  const vh = sorted[hi];
  return vl === vh ? vl : vl + (h - lo) * (vh - vl);
}

function aggregateValue(agg: Aggregation, items: readonly Row[], listFrame: boolean): Value {
  const fn = agg.fn.toLowerCase();
  const nums = numbersOf(items, agg.field);
  switch (fn) {
    case "sum":
      return sum(nums, listFrame);
    case "avg":
      return nums.length === 0 ? null : sum(nums, listFrame) / nums.length;
    case "min":
      return nums.length === 0 ? null : minOf(nums);
    case "max":
      return nums.length === 0 ? null : maxOf(nums);
    case "count":
      return long(nonNullCount(items, agg.field));
    case "median":
      return percentileOf(sortedDoubles(nums.filter((n) => !Number.isNaN(n))), 50);
    case "percentile":
      return percentileOf(sortedDoubles(nums.filter((n) => !Number.isNaN(n))), agg.p!);
    default: {
      const keys = new KeyBuilder();
      const distinct = new Set<string>();
      for (const row of items) {
        const v = cell(row, agg.field);
        if (v !== null) distinct.add(keys.scalar(v));
      }
      return long(distinct.size);
    }
  }
}

export const aggregateHandler: StepHandler<AggregateConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      groupBy: typedArray(obj, "groupBy", "an array of {name, type} objects", (item) => {
        const o = readObject(item);
        reqString(o, "type");
        return reqString(o, "name");
      }),
      aggregations: typedArray(
        obj,
        "aggregations",
        "an array of {alias, fn, field, p?} objects",
        (item) => {
          const o = readObject(item);
          return {
            alias: reqString(o, "alias"),
            fn: reqString(o, "fn"),
            field: reqString(o, "field"),
            p: optNumber(o, "p"),
          };
        },
      ),
    };
  },
  problems: () => [],
  apply(rows, { groupBy, aggregations }, ctx) {
    const listFrame = ctx.listFrame === true;
    const problems = aggregations
      .map(aggregationProblem)
      .filter((p): p is string => p !== undefined);
    if (problems.length > 0) throw new StepConfigError(problems.join("; "));
    if (rows.length === 0 && groupBy.length === 0) {
      const out: Record<string, Value> = {};
      for (const agg of aggregations) {
        const fn = agg.fn.toLowerCase();
        put(out, agg.alias, fn === "count" || fn === "count_distinct" ? long(0) : null);
      }
      return [out];
    }
    return scalaGroupBy(rows, (row) => groupBy.map((c) => cell(row, c))).map((group): Row => {
      const out: Record<string, Value> = {};
      groupBy.forEach((c, i) => put(out, c, group.keyValues[i]));
      for (const agg of aggregations)
        put(out, agg.alias, aggregateValue(agg, group.items, listFrame));
      return out;
    });
  },
};

// --- pivot -------------------------------------------------------------------------------------------

interface PivotConfig {
  index: string[];
  column: string;
  values: string;
  agg: string;
}

const PIVOT_AGGS = ["sum", "count", "avg", "min", "max", "first"];

function pivotValue(agg: string, values: string, items: readonly Row[], listFrame: boolean): Value {
  switch (agg) {
    case "sum":
      return sum(numbersOf(items, values), listFrame);
    case "count":
      return long(nonNullCount(items, values));
    case "first":
      return cell(items[0], values);
    default: {
      const nums = numbersOf(items, values);
      if (nums.length === 0) return null;
      if (agg === "avg") return sum(nums, listFrame) / nums.length;
      return agg === "min" ? minOf(nums) : maxOf(nums);
    }
  }
}

export const pivotHandler: StepHandler<PivotConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      index: stringArray(obj, "index"),
      column: str(obj, "column", ""),
      values: str(obj, "values", ""),
      agg: str(obj, "agg", ""),
    };
  },
  problems: (c) =>
    missingRequired("pivot", [
      ["column", c.column],
      ["values", c.values],
    ]),
  apply(rows, { index, column, values, agg }, ctx) {
    const listFrame = ctx.listFrame === true;
    if (!PIVOT_AGGS.includes(agg)) {
      throw new StepConfigError(
        `Unsupported pivot aggregation function: '${agg}'. Supported: ${PIVOT_AGGS.join(", ")}`,
      );
    }
    return scalaGroupBy(rows, (row) => index.map((c) => cell(row, c))).map((group): Row => {
      const out: Record<string, Value> = {};
      index.forEach((c, i) => put(out, c, group.keyValues[i]));
      const withPivot = group.items.filter((row) => cell(row, column) !== null);
      const valueColumns: Record<string, Value> = {};
      for (const byValue of scalaGroupByValue(withPivot, (row) => cell(row, column))) {
        const name = `${values}_${anyToString(byValue.keyValues[0] as Exclude<Value, null>)}`;
        put(valueColumns, name, pivotValue(agg, values, byValue.items, listFrame));
      }
      for (const name of Object.keys(valueColumns)) put(out, name, valueColumns[name]);
      return out;
    });
  },
};
