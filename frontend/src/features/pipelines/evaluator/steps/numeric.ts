// HEL-1581 — shared numeric coercion and the Double ordering/aggregation helpers the steps use
// (`PipelineRowJson.toDouble`, Scala's `Seq[Double].sum/min/max/sorted` under `Ordering.Double.TotalOrdering`).

import { toDoubleOption } from "../javaNumbers";
import { Integral, type Value } from "../value";

/** `PipelineRowJson.toDouble`: numbers as themselves, numeric strings through `toDoubleOption`, else none. */
export function toDouble(v: Value): number | undefined {
  if (v === null) return undefined;
  if (typeof v === "number") return v;
  if (v instanceof Integral) return v.value;
  if (typeof v === "string") return toDoubleOption(v);
  return undefined;
}

/** `java.lang.Double.compare`: -0.0 sorts before 0.0 and NaN after every number. */
export function totalCompare(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === b) {
    if (a !== 0) return 0;
    const aNeg = Object.is(a, -0);
    const bNeg = Object.is(b, -0);
    return aNeg === bNeg ? 0 : aNeg ? -1 : 1;
  }
  const aNan = Number.isNaN(a);
  const bNan = Number.isNaN(b);
  return aNan === bNan ? 0 : aNan ? 1 : -1;
}

/**
 * `Seq[Double].sum` (scala-library 2.13.15 `IterableOnce.sum`): a collection with a known size reduces from its
 * first element, so a Vector of only `-0.0` sums to `-0.0`; one without (a `List`) folds from `0.0`, which
 * gives `0.0`. Frames are Vectors straight from a source, and Lists downstream of aggregate / groupby / pivot,
 * hence `listFrame`.
 */
export function sum(nums: readonly number[], listFrame: boolean): number {
  if (nums.length === 0) return 0;
  let total = listFrame ? 0 : nums[0];
  for (let i = listFrame ? 0 : 1; i < nums.length; i++) total += nums[i];
  return total;
}

/** `Seq[Double].min` / `.max` under the total ordering (NaN is the greatest value). */
export function minOf(nums: readonly number[]): number {
  let best = nums[0];
  for (let i = 1; i < nums.length; i++) if (totalCompare(nums[i], best) < 0) best = nums[i];
  return best;
}

export function maxOf(nums: readonly number[]): number {
  let best = nums[0];
  for (let i = 1; i < nums.length; i++) if (totalCompare(nums[i], best) > 0) best = nums[i];
  return best;
}

/** `Seq[Double].sorted` (ascending, total ordering, stable). */
export function sortedDoubles(nums: readonly number[]): number[] {
  return [...nums].sort(totalCompare);
}
