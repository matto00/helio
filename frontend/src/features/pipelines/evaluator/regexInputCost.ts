// HEL-1697 -- the predicted main-thread cost of an accepted regex over an input frame (design D1 and addenda). A step whose
// cost exceeds REGEX_WORK_BUDGET is declined to the server draft preview as `regexInputCost`.

import type { Ranges } from "./javaRegexSets";
import type { RegexWork } from "./javaRegexCost";

/**
 * The predicted regex work (units of the cost formula) one extractRegex step may cost on the main thread. Calibrated in
 * `.concertino/runs/HEL-1697/evidence/regex-work-calibration.md`: derived as `floor(20 ms / max measured ns per unit)` over
 * the calibration list, then pinned at the floor the `(\d+)` scenario needs (1,000 x 2,000 digits cost exactly 4.00e6).
 * Every calibration row measures at most 50 ms at this budget; rows over 20 ms are recorded there as accepted risk.
 */
export const REGEX_WORK_BUDGET = 4_000_000;

/** V8 runs class-with-lone-surrogate patterns about twice as slowly per unit, so each unpaired surrogate counts double. */
const LONE_SURROGATE_UNITS = 2;

function inRanges(ranges: Ranges, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** `f x (A x len + sum over maximal runs R of (R x A x min(R, W) + m x R^2))`, run and `len` lengths in UTF-16 units. */
export function cellWork(text: string, work: RegexWork): number {
  const { A, W, m, f, chars } = work;
  let len = 0;
  let run = 0;
  let total = 0;
  const endRun = (): void => {
    total += run * A * Math.min(run, W) + m * run * run;
    run = 0;
  };
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const pair = cp > 0xffff;
    const lone = !pair && cp >= 0xd800 && cp <= 0xdfff;
    const units = pair ? 2 : lone ? LONE_SURROGATE_UNITS : 1;
    len += units;
    if (inRanges(chars, cp)) run += units;
    else endRun();
    i += pair ? 2 : 1;
  }
  endRun();
  return f * (A * len + total);
}

/** Matches only unpaired surrogates: under the `u` flag a surrogate pair is one code point and does not match. */
const LONE_SURROGATE = /[\ud800-\udfff]/u;

/**
 * A true upper bound of `cellWork`: the whole cell as one run of the longest possible unit length `L` (UTF-16 length, doubled
 * only when the cell has an unpaired surrogate). The run term is monotone in the run length and the runs sum to at most `L`,
 * so `sum R x A x min(R, W) <= L x A x min(L, W)` and `m x sum R^2 <= m x L^2`; `A x len <= A x L`. Needs no per-character scan.
 */
export function cellWorkBound(text: string, work: RegexWork): number {
  const { A, W, m, f } = work;
  const L = LONE_SURROGATE.test(text) ? LONE_SURROGATE_UNITS * text.length : text.length;
  return f * (A * L + L * A * Math.min(L, W) + m * L * L);
}

/**
 * Whether the summed `cellWork` of `texts` exceeds REGEX_WORK_BUDGET. Decision-identical to summing `cellWork`: the exact
 * per-character scan runs only when the closed-form upper bound already exceeds the budget (ordinary frames skip it).
 */
export function workExceedsBudget(texts: readonly string[], work: RegexWork): boolean {
  let bound = 0;
  for (const text of texts) {
    bound += cellWorkBound(text, work);
    if (bound > REGEX_WORK_BUDGET) break;
  }
  if (bound <= REGEX_WORK_BUDGET) return false;
  let total = 0;
  for (const text of texts) {
    total += cellWork(text, work);
    if (total > REGEX_WORK_BUDGET) return true;
  }
  return false;
}
