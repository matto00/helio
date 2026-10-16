// HEL-1581 — filter and sort (ports of `FilterStep.scala` and `SortStep.scala`).

import {
  asObject,
  normalizeEnum,
  optString,
  readObject,
  reqString,
  str,
  typedArray,
  unsupportedEnum,
} from "../config";
import { equalsIgnoreCase, parseDouble } from "../javaNumbers";
import { anyToString, cell, Integral, numericOf, type Frame, type Value } from "../value";
import { javaSort } from "../javaTimSort";
import { toDouble, totalCompare } from "./numeric";
import type { StepHandler } from "./types";

// --- filter ------------------------------------------------------------------------------------------

interface FilterCondition {
  field: string;
  operator: string;
  value: string | undefined;
}

interface FilterConfig {
  combinator: string;
  conditions: FilterCondition[];
}

const COMBINATORS = ["AND", "OR"] as const;

function numericFieldValue(v: Value): number | undefined {
  return typeof v === "number" || v instanceof Integral ? numericOf(v) : undefined;
}

/** `v.toString.toDouble` wrapped in a `Try` (Java `parseDouble`). */
function stringifiedDouble(v: Value): number | undefined {
  if (v === null) return undefined;
  const n = numericOf(v);
  return n !== undefined ? n : parseDouble(anyToString(v));
}

function evalCondition(fieldVal: Value, operator: string, value: string | undefined): boolean {
  switch (operator) {
    case "is null":
      return fieldVal === null;
    case "is not null":
      return fieldVal !== null;
    case "contains": {
      const needle = value ?? "";
      return fieldVal === null ? needle === "" : anyToString(fieldVal).includes(needle);
    }
    case "=":
    case "!=": {
      const f = numericFieldValue(fieldVal);
      const v = value === undefined ? undefined : parseDouble(value);
      let isEqual: boolean;
      if (f !== undefined && v !== undefined) {
        isEqual = f === v;
      } else {
        const valStr = value ?? "";
        const fieldStr = fieldVal === null ? (valStr === "" ? "" : null) : anyToString(fieldVal);
        isEqual = fieldStr === valStr;
      }
      return operator === "=" ? isEqual : !isEqual;
    }
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const f = stringifiedDouble(fieldVal);
      const v = parseDouble(value ?? "");
      if (f === undefined || v === undefined) return false;
      if (operator === ">") return f > v;
      if (operator === ">=") return f >= v;
      return operator === "<" ? f < v : f <= v;
    }
    default:
      return false;
  }
}

export const filterHandler: StepHandler<FilterConfig> = {
  stepClass: "client",
  decode(raw) {
    const obj = asObject(raw);
    return {
      combinator: normalizeEnum(str(obj, "combinator", "AND"), COMBINATORS),
      conditions: typedArray(
        obj,
        "conditions",
        "an array of {field, operator, value} objects",
        (item) => {
          const o = readObject(item);
          return {
            field: reqString(o, "field"),
            operator: reqString(o, "operator"),
            value: optString(o, "value"),
          };
        },
      ),
    };
  },
  problems: (c) => unsupportedEnum("filter", "combinator", c.combinator, COMBINATORS),
  apply(rows, { combinator, conditions }) {
    if (conditions.length === 0) return rows;
    const active = conditions.filter((c) => c.field !== "");
    if (active.length === 0) return rows;
    const isOr = combinator.toUpperCase() === "OR";
    return rows.filter((row) => {
      if (isOr) return active.some((c) => evalCondition(cell(row, c.field), c.operator, c.value));
      return active.every((c) => evalCondition(cell(row, c.field), c.operator, c.value));
    });
  },
};

// --- sort --------------------------------------------------------------------------------------------

interface SortKey {
  field: string;
  direction: string;
}

/** The three-tier key of a non-null value: finite numbers, then everything else lexicographically. */
interface Ranked {
  numeric: number | undefined;
  text: string;
}

function rank(v: Value): Ranked {
  const d = toDouble(v);
  return { numeric: d !== undefined && Number.isFinite(d) ? d : undefined, text: "" };
}

function compareRanked(
  x: Ranked,
  y: Ranked,
  xv: Exclude<Value, null>,
  yv: Exclude<Value, null>,
): number {
  if (x.numeric !== undefined && y.numeric !== undefined) return totalCompare(x.numeric, y.numeric);
  if (x.numeric !== undefined) return -1;
  if (y.numeric !== undefined) return 1;
  const a = anyToString(xv);
  const b = anyToString(yv);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortByKey(rows: Frame, { field, direction }: SortKey): Frame {
  const desc = equalsIgnoreCase(direction, "desc");
  const keyed = rows.map((row) => {
    const v = cell(row, field);
    return { row, v, ranked: v === null ? undefined : rank(v) };
  });
  const sorted = javaSort(keyed, (a, b) => {
    if (a.v === null || b.v === null) return a.v === null ? (b.v === null ? 0 : 1) : -1;
    const cmp = compareRanked(a.ranked!, b.ranked!, a.v, b.v);
    return desc ? -cmp : cmp;
  });
  return sorted.map((k) => k.row);
}

export const sortHandler: StepHandler<{ sortBy: SortKey[] }> = {
  stepClass: "client*",
  decode: (raw) => ({
    sortBy: typedArray(
      asObject(raw),
      "sortBy",
      "an array of {field, direction} objects",
      (item) => {
        const o = readObject(item);
        return { field: reqString(o, "field"), direction: reqString(o, "direction") };
      },
    ),
  }),
  problems: () => [],
  apply(rows, { sortBy }) {
    if (sortBy.length === 0) return rows;
    let current = rows;
    for (let i = sortBy.length - 1; i >= 0; i--) {
      if (sortBy[i].field !== "") current = sortByKey(current, sortBy[i]);
    }
    return current;
  },
};
