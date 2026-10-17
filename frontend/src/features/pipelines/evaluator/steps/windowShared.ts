// HEL-1581 — what the window step's two halves share: the config shape and the row ordering
// (`WindowStep.rowOrdering` / `compareValues`).

import { equalsIgnoreCase } from "../javaNumbers";
import { anyToString, cell, type Row, type Value } from "../value";
import { totalCompare, toDouble } from "./numeric";

export interface SortKey {
  field: string;
  direction: string;
}

export interface WindowConfig {
  partitionBy: string[];
  orderBy: SortKey[];
  function: string;
  field: string | undefined;
  outputColumn: string;
  offset: number | undefined;
  frameSize: number | undefined;
  frameUnit: string | undefined;
}

export const ROLLING = [
  "rolling_avg",
  "rolling_sum",
  "rolling_min",
  "rolling_max",
  "rolling_count",
];

export type Indexed = { row: Row; idx: number };

/** `compareValues`: numeric when both parse (including NaN/Infinity), else by `toString`; nulls last. */
export function compareValues(a: Value, b: Value, desc: boolean): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  const x = toDouble(a);
  const y = toDouble(b);
  let cmp: number;
  if (x !== undefined && y !== undefined) {
    cmp = totalCompare(x, y);
  } else {
    const sa = anyToString(a);
    const sb = anyToString(b);
    cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return desc ? -cmp : cmp;
}

export function rowOrdering(orderBy: readonly SortKey[]): (a: Indexed, b: Indexed) => number {
  return (a, b) => {
    for (const key of orderBy) {
      const cmp = compareValues(
        cell(a.row, key.field),
        cell(b.row, key.field),
        equalsIgnoreCase(key.direction, "desc"),
      );
      if (cmp !== 0) return cmp;
    }
    return a.idx - b.idx;
  };
}
