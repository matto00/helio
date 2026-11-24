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

/**
 * `f x (A x len + sum over maximal runs R of (R x A x min(R, W) + m x R^2))`, run and `len` lengths in UTF-16 units. A
 * start-anchored pattern (HEL-1807) is charged for its one attempt per cell, and never more than this per-position charge.
 */
export function cellWork(text: string, work: RegexWork): number {
  return work.anchored ? anchoredCellWork(text, work) : perPositionWork(text, work);
}

/** Membership of every BMP value in `chars`, built once per `chars` array (cached for as long as the compiled pattern lives). */
const bmpTables = new WeakMap<Ranges, Uint8Array>();

function bmpTable(chars: Ranges): Uint8Array {
  let table = bmpTables.get(chars);
  if (!table) {
    table = new Uint8Array(0x10000);
    for (const [lo, hi] of chars) if (lo <= 0xffff) table.fill(1, lo, Math.min(hi, 0xffff) + 1);
    bmpTables.set(chars, table);
  }
  return table;
}

/**
 * HEL-1836 -- the per-position charge, reading UTF-16 code units. A unit outside U+D800-U+DFFF is one unit whose membership is
 * `table[c]`; a valid high-low pair is one astral code point of two units (membership by `inRanges`, as before); any other
 * surrogate unit is unpaired, charged `LONE_SURROGATE_UNITS`, and `codePointAt` would have returned the unit itself for it, so
 * `table[c]` is the same answer. `chars` is sorted, merged and disjoint, so the table agrees with `inRanges` on every BMP value
 * and the charge equals the `codePointAt` + `inRanges` scan's for every string.
 */
function perPositionWork(text: string, work: RegexWork): number {
  const { A, W, m, f, chars } = work;
  const table = bmpTable(chars);
  const n = text.length;
  // `len` is `n` plus one per unpaired surrogate (a pair is two units over two code units, an unpaired one is two units over one).
  let extra = 0;
  let run = 0;
  let total = 0;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i++);
    if (c < 0xd800 || c > 0xdfff) {
      if (table[c] === 1) run++;
      else if (run > 0) {
        total += run * A * Math.min(run, W) + m * run * run;
        run = 0;
      }
      continue;
    }
    const d = c <= 0xdbff && i < n ? text.charCodeAt(i) : 0;
    const pair = d >= 0xdc00 && d <= 0xdfff;
    const member = pair
      ? inRanges(chars, ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000)
      : table[c] === 1;
    const units = LONE_SURROGATE_UNITS;
    if (pair) i++;
    else extra += units - 1;
    if (member) run += units;
    else if (run > 0) {
      total += run * A * Math.min(run, W) + m * run * run;
      run = 0;
    }
  }
  total += run * A * Math.min(run, W) + m * run * run;
  return f * (A * (n + extra) + total);
}

/**
 * HEL-1807 -- a start-anchored cell: V8 makes one attempt per alternative path, at position 0, so the charge is the constant
 * work of those attempts `A x (1 + W)` plus at most the `R0` units of the run that starts at the cell's first code point (`A`
 * per consumed unit, `m` per give-back of the one unfenced wide quantifier): `f x (A x (1 + W) + R0 x (A + m))`. The smaller of
 * that and the per-position charge applies (`min`, so no pattern is charged more than before). One pass: the first run gives
 * `R0`, and the cell is read past it only when the per-position charge could still be lower, which needs `anchoredCost` above
 * `f x A x text.length` (the per-position charge is at least that), so the characters read stay within the charge itself.
 * Calibrated in `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/calibration.md`.
 */
function anchoredCellWork(text: string, work: RegexWork): number {
  const { A, W, m, f, chars } = work;
  const anchoredCost = (r0: number): number => f * (A * (1 + W) + r0 * (A + m));
  let len = 0;
  let run = 0;
  let total = 0;
  let first = true;
  let attempt = 0;
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
    else {
      if (first) {
        first = false;
        attempt = anchoredCost(run);
        if (attempt <= f * A * text.length) return attempt;
      }
      endRun();
    }
    i += pair ? 2 : 1;
  }
  if (first) attempt = anchoredCost(run);
  endRun();
  return Math.min(attempt, f * (A * len + total));
}

/** Matches only unpaired surrogates: under the `u` flag a surrogate pair is one code point and does not match. */
const LONE_SURROGATE = /[\ud800-\udfff]/u;

/**
 * A true upper bound of `cellWork`: the whole cell as one run of its unit length `L` (HEL-1836 non-anchored: the exact `len`
 * `cellWork` sums, `unitLength`; anchored: twice the UTF-16 length). The run term is monotone in the run length and the runs sum to at most `L`,
 * so `sum R x A x min(R, W) <= L x A x min(L, W)` and `m x sum R^2 <= m x L^2`; `A x len <= A x L`. Needs no per-character scan.
 */
export function cellWorkBound(text: string, work: RegexWork): number {
  // HEL-1807: an anchored cell takes the longest possible unit length `L = 2 x text.length` with no per-cell lone-surrogate
  // test (on two-byte cells that test dominated the decision, calibration.md "lone-surrogate fallback rule").
  if (work.anchored) return boundAt(work, LONE_SURROGATE_UNITS * text.length);
  // HEL-1836: the exact unit length `perPositionWork` sums (never above the old doubling), so it stays a true upper bound.
  return boundAt(work, unitLength(text));
}

/** The closed-form bound for a cell of at most `L` units; an anchored pattern takes the smaller of its two bounds. */
function boundAt(work: RegexWork, L: number): number {
  const { A, W, m, f } = work;
  const perPosition = A * L + L * A * Math.min(L, W) + m * L * L;
  return f * (work.anchored ? Math.min(perPosition, A * (1 + W) + L * (A + m)) : perPosition);
}

/** `String.prototype.isWellFormed` (ES2024; the project's type library predates it): true when the string has no unpaired surrogate. */
const nativeIsWellFormed = (String.prototype as { isWellFormed?: () => boolean }).isWellFormed;
const hasNoLoneSurrogate: (text: string) => boolean = nativeIsWellFormed
  ? (text) => nativeIsWellFormed.call(text)
  : (text) => !LONE_SURROGATE.test(text);

/**
 * HEL-1823 -- a cell's exact unit length: its UTF-16 length plus one per unpaired surrogate (an unpaired surrogate is one
 * UTF-16 unit and charged `LONE_SURROGATE_UNITS`, a pair is two units and charged two), the same `len` `cellWork` sums. A cell
 * without an unpaired surrogate (the usual case) costs one native check; only a cell that has one is counted, by a code-unit
 * loop. Measured against a native replace-and-compare count and a gate-free loop in this change's calibration.md.
 */
function unitLength(text: string): number {
  if (hasNoLoneSurrogate(text)) return text.length;
  let lone = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0xd800 || c > 0xdfff) continue;
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) i++;
    else lone++;
  }
  return text.length + (LONE_SURROGATE_UNITS - 1) * lone;
}

/**
 * HEL-1807 -- the second, tighter bound of an anchored frame whose surrogate-free bound is over the budget: `L` is the cell's
 * exact unit length (`unitLength`; HEL-1823 charges each unpaired surrogate its own extra unit, where HEL-1807 doubled the whole
 * cell for the first one), so it never under-states `cellWork`. When the first run covers the cell and the pattern has no tail
 * (`^(\d+)`, `^([^...]+)`), this bound equals the exact charge, so the exact scan is skipped (calibration.md, "Final-gate
 * round 1": that scan was the 21-34 ms case).
 */
function testedBound(text: string, work: RegexWork): number {
  return boundAt(work, unitLength(text));
}

/**
 * HEL-1823 -- the least `testedBound` a cell can have (no unpaired surrogate, `L = text.length`). A frame whose sum of these is
 * already over the budget cannot be admitted by the tested bound, so its cells are not counted (a cell the exact scan can leave
 * after its first character must not be read in full here).
 */
function lengthBound(text: string, work: RegexWork): number {
  return boundAt(work, text.length);
}

function boundExceeds(
  texts: readonly string[],
  work: RegexWork,
  bound: typeof cellWorkBound,
): boolean {
  let sum = 0;
  for (const text of texts) {
    sum += bound(text, work);
    if (sum > REGEX_WORK_BUDGET) return true;
  }
  return false;
}

/**
 * Whether the summed `cellWork` of `texts` exceeds REGEX_WORK_BUDGET. Decision-identical to summing `cellWork`: the exact
 * per-character scan runs only when the closed-form upper bound already exceeds the budget (ordinary frames skip it).
 */
export function workExceedsBudget(texts: readonly string[], work: RegexWork): boolean {
  if (work.anchored) {
    if (!boundExceeds(texts, work, cellWorkBound)) return false;
    if (!boundExceeds(texts, work, lengthBound) && !boundExceeds(texts, work, testedBound)) {
      return false;
    }
  } else if (!boundExceeds(texts, work, lengthBound) && !boundExceeds(texts, work, cellWorkBound)) {
    // HEL-1836: when even the length-only sum (each cell at its least possible bound) is over the budget, the stage-1 sum, at
    // least as large because `boundAt` is non-decreasing in `L` and `unitLength >= text.length`, is too, so the exact scan
    // cannot be avoided and the per-cell surrogate test is skipped. Decision-identical either way.
    return false;
  }
  let total = 0;
  for (const text of texts) {
    total += cellWork(text, work);
    if (total > REGEX_WORK_BUDGET) return true;
  }
  return false;
}
