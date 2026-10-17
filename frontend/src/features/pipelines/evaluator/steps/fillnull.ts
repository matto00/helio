// HEL-1581 — fillnull (port of `FillNullStep.scala`).

import { StepConfigError, asObject, str, strOpt, stringArray } from "../config";
import { KeyBuilder } from "../scalaGroup";
import { cell, put, type Row, type Value } from "../value";
import { sortedDoubles, sum, toDouble } from "./numeric";
import type { StepHandler } from "./types";

interface FillNullConfig {
  columns: string[];
  strategy: string;
  value: string | undefined;
}

const STRATEGIES = ["constant", "forwardFill", "mean", "median", "mode"];

type Stat = (rows: readonly Row[], column: string, listFrame: boolean) => Value | undefined;

function numbersOf(rows: readonly Row[], column: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const d = toDouble(cell(row, column));
    if (d !== undefined) out.push(d);
  }
  return out;
}

const mean: Stat = (rows, column, listFrame) => {
  const nums = numbersOf(rows, column);
  return nums.length === 0 ? undefined : sum(nums, listFrame) / nums.length;
};

const median: Stat = (rows, column) => {
  const nums = sortedDoubles(numbersOf(rows, column));
  if (nums.length === 0) return undefined;
  const n = nums.length;
  return n % 2 === 1 ? nums[(n - 1) / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2;
};

/** The most frequent non-null value; a tie goes to the value seen first (and the first spelling of it). */
const mode: Stat = (rows, column) => {
  const keys = new KeyBuilder();
  const counts = new Map<string, { value: Value; count: number }>();
  for (const row of rows) {
    const v = cell(row, column);
    if (v === null) continue;
    const key = keys.scalar(v);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { value: v, count: 1 });
  }
  let best: { value: Value; count: number } | undefined;
  for (const entry of counts.values())
    if (best === undefined || entry.count > best.count) best = entry;
  return best?.value;
};

function fillWithStat(
  rows: readonly Row[],
  columns: readonly string[],
  stat: Stat,
  listFrame: boolean,
): Row[] {
  const stats = new Map<string, Value | undefined>();
  for (const column of columns) stats.set(column, stat(rows, column, listFrame));
  return rows.map((row) => {
    let out: Record<string, Value> | undefined;
    for (const column of columns) {
      const s = stats.get(column);
      if (cell(row, column) === null && s !== undefined) {
        out ??= { ...row };
        put(out, column, s);
      }
    }
    return out ?? row;
  });
}

export const fillNullHandler: StepHandler<FillNullConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      columns: stringArray(obj, "columns"),
      strategy: str(obj, "strategy", ""),
      value: strOpt(obj, "value"),
    };
  },
  problems: () => [],
  apply(rows, { columns, strategy, value }, ctx) {
    if (!STRATEGIES.includes(strategy)) {
      throw new StepConfigError(
        `Unsupported fillnull strategy: '${strategy}'. Supported: ${STRATEGIES.join(", ")}`,
      );
    }
    switch (strategy) {
      case "constant": {
        if (value === undefined)
          throw new StepConfigError("fillnull strategy 'constant' requires 'value'");
        const fill = value;
        return rows.map((row) => {
          let out: Record<string, Value> | undefined;
          for (const column of columns) {
            if (cell(out ?? row, column) === null) {
              out ??= { ...row };
              put(out, column, fill);
            }
          }
          return out ?? row;
        });
      }
      case "forwardFill": {
        const lastSeen = new Map<string, Value>();
        for (const column of columns) lastSeen.set(column, null);
        return rows.map((row) => {
          let out: Record<string, Value> | undefined;
          for (const column of columns) {
            const current = cell(row, column);
            if (current !== null) {
              lastSeen.set(column, current);
            } else {
              const carried = lastSeen.get(column) ?? null;
              if (carried !== null) {
                out ??= { ...row };
                put(out, column, carried);
              }
            }
          }
          return out ?? row;
        });
      }
      case "mean":
        return fillWithStat(rows, columns, mean, ctx.listFrame === true);
      case "median":
        return fillWithStat(rows, columns, median, ctx.listFrame === true);
      default:
        return fillWithStat(rows, columns, mode, ctx.listFrame === true);
    }
  },
};
