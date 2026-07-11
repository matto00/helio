// ── Panel-level viz aggregation (HEL-292) ───────────────────────────────────
//
// Mirrors `AggregateStep.scala`'s semantics exactly so a viz-level aggregate
// (metric `value` slot, chart groupBy) matches what a dedicated `aggregate`
// pipeline step would produce for the same field/function. There is no shared
// runtime between Scala and TS — this is a deliberate reimplementation; keep
// it in sync with `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala`
// (see `AggregateStepSpec` for the reference scenarios these tests mirror).
//
// Numeric coercion: a native `number` is used directly. A `string` is
// coercible only when `s.trim() !== "" && Number.isFinite(Number(s))` — the
// explicit non-empty guard matters because `Number("")` and `Number("  ")`
// both evaluate to `0`, which would silently treat a blank/absent value as a
// real zero (this mirrors Scala's `s.toDoubleOption`, which rejects `""`).
// Non-coercible values (including `null`/`undefined`) are skipped for
// sum/avg/min/max; `count` only cares about non-null/non-undefined.

import type { AggFn } from "../features/panels/types/panel";

/** Row shape aggregation operates over — the typed rows `usePanelData`
 *  already fetches (NOT the stringified `rawRows` passed to `ChartPanel`,
 *  which collapses `null`/`undefined` and `""` into the same sentinel). */
export type AggregatableRow = Record<string, unknown>;

/** Coerce a single cell to a finite number, or `null` if not coercible.
 *
 * Documented divergence (HEL-297): Scala's `s.toDoubleOption` (used by the pipeline
 * `AggregateStep`, the backend counterpart this module otherwise mirrors "exactly") follows
 * Java's `Double.parseDouble` grammar, which parses the literal strings `"Infinity"`,
 * `"-Infinity"`, and `"+Infinity"` as real (non-finite) doubles. This function's
 * `Number.isFinite` guard deliberately excludes them instead — the `panel-viz-aggregation` spec
 * requires TS aggregation to operate over values "coercible to a finite number," and letting
 * `"Infinity"` through would let a non-finite result flow into a chart's bar height or a metric's
 * value slot. Accepting it would itself be a spec-level behavior change; this is intentional,
 * not an oversight. See design.md Decision 2 for the full rationale. */
function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compute a single aggregate (`agg`) of `field` across `rows`, matching
 *  `AggregateStep`'s semantics:
 *  - `count`: number of rows where `field` is non-null/non-undefined
 *  - `sum`: sum of coercible numeric values; `0` when none are coercible
 *  - `avg`/`min`/`max`: over coercible numeric values; `null` when none are
 *    coercible */
export function computeAggregate(
  rows: AggregatableRow[],
  field: string,
  agg: AggFn,
): number | null {
  switch (agg) {
    case "count":
      return rows.reduce((n, row) => (row[field] != null ? n + 1 : n), 0);
    case "sum": {
      const nums = rows
        .map((row) => coerceNumber(row[field]))
        .filter((n): n is number => n !== null);
      return nums.reduce((a, b) => a + b, 0);
    }
    case "avg": {
      const nums = rows
        .map((row) => coerceNumber(row[field]))
        .filter((n): n is number => n !== null);
      return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case "min": {
      const nums = rows
        .map((row) => coerceNumber(row[field]))
        .filter((n): n is number => n !== null);
      return nums.length === 0 ? null : Math.min(...nums);
    }
    case "max": {
      const nums = rows
        .map((row) => coerceNumber(row[field]))
        .filter((n): n is number => n !== null);
      return nums.length === 0 ? null : Math.max(...nums);
    }
  }
}

export interface GroupedAggregate {
  categories: string[];
  values: number[];
}

/** Group `rows` by `groupBy` and compute one `agg(yField)` per group, using
 *  `computeAggregate`'s coercion guard per group (not a parallel numeric
 *  check). Groups are sorted by category key for stable chart rendering.
 *  A `null`/`undefined` groupBy value is stringified via `String(...)` after
 *  grouping, matching how the rest of the panel layer treats missing keys. */
export function groupAndAggregate(
  rows: AggregatableRow[],
  groupBy: string,
  agg: AggFn,
  yField: string,
): GroupedAggregate {
  const groups = new Map<string, AggregatableRow[]>();
  for (const row of rows) {
    const key = String(row[groupBy]);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const categories = Array.from(groups.keys()).sort();
  const values = categories.map((key) => computeAggregate(groups.get(key) ?? [], yField, agg) ?? 0);

  return { categories, values };
}
