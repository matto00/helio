// HEL-1683 -- code-point sets for the regex allowlist's backtracking check (javaRegexCost.ts). A set is a sorted list of
// disjoint inclusive code-point ranges over 0..0x10FFFF, built from the same definitions the translator (javaRegex.ts) emits
// for the `u`-mode RegExp, so a disjointness answer here is the answer the engine would give.

export type Ranges = ReadonlyArray<readonly [number, number]>;

const MAX_CODE_POINT = 0x10ffff;

/** Sorts and merges overlapping or adjacent ranges. */
function normalize(ranges: Array<readonly [number, number]>): Ranges {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [lo, hi] of sorted) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && lo <= prev[1] + 1) prev[1] = Math.max(prev[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

export function pointSet(codePoint: number): Ranges {
  return [[codePoint, codePoint]];
}

export function rangeSet(lo: number, hi: number): Ranges {
  return [[lo, hi]];
}

export function unionSets(sets: ReadonlyArray<Ranges>): Ranges {
  return normalize(sets.flatMap((s) => [...s]));
}

export function complementSet(set: Ranges): Ranges {
  const out: Array<readonly [number, number]> = [];
  let next = 0;
  for (const [lo, hi] of normalize([...set])) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);
  return out;
}

export function disjointSets(a: Ranges, b: Ranges): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i][1] < b[j][0]) i++;
    else if (b[j][1] < a[i][0]) j++;
    else return false;
  }
  return true;
}

const DIGIT = rangeSet(0x30, 0x39);
const WORD = unionSets([
  rangeSet(0x30, 0x39),
  rangeSet(0x41, 0x5a),
  pointSet(0x5f),
  rangeSet(0x61, 0x7a),
]);
/** `SPACE_CLASS_BODY` in javaRegex.ts: space, \t \n \x0B \f \r. */
export const SPACE = unionSets([pointSet(0x20), rangeSet(0x09, 0x0d)]);
/** `DOT` in javaRegex.ts: everything except the line terminators \n, \r, U+0085, U+2028 and U+2029. */
export const DOT_SET = complementSet(
  unionSets([pointSet(0x0a), pointSet(0x0d), pointSet(0x85), rangeSet(0x2028, 0x2029)]),
);

/** The set of a simple escape letter the allowlist accepts (`SIMPLE_ESCAPES` in javaRegex.ts), or undefined. */
export function simpleEscapeSet(letter: string): Ranges | undefined {
  switch (letter) {
    case "t":
      return pointSet(0x09);
    case "n":
      return pointSet(0x0a);
    case "r":
      return pointSet(0x0d);
    case "f":
      return pointSet(0x0c);
    case "d":
      return DIGIT;
    case "D":
      return complementSet(DIGIT);
    case "w":
      return WORD;
    case "W":
      return complementSet(WORD);
    default:
      return undefined;
  }
}
