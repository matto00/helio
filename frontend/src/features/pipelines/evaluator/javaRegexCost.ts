// HEL-1683 -- the backtracking check of the regex allowlist (design D2). A pattern the allowlist tokenizes is an alternation tree
// of sequences of items (groups are never quantified), so super-linear backtracking per start position can only come from
// several choice points trading the same characters. `isBacktrackBounded` is a static, conservative test: a `false` answer
// declines the pattern to the server, which evaluates it under its 2 s per-step regex time budget.

import { disjointSets, unionSets, type Ranges } from "./javaRegexSets";

export interface AtomItem {
  kind: "atom";
  set: Ranges;
  min: number;
  max: number;
}
export interface AnchorItem {
  kind: "anchor";
  dollar: boolean;
}
export interface GroupItem {
  kind: "group";
  alts: Item[][];
}
export type Item = AtomItem | AnchorItem | GroupItem;

/** A choice quantifier is wide when unbounded or when it admits more than this many extents. */
const WIDE_EXTENTS = 16;
/** Bound on (paths x weight) of the whole pattern when it has more than one path. */
const MAX_COST = 64;
/** Bound on (paths x weight of the tail after the one unfenced wide quantifier). */
const MAX_TAIL_COST = 4;
/** `$` is emitted as two lookaheads, one holding a lookbehind: about twice a character step. */
const DOLLAR_WEIGHT = 2;

const isChoice = (a: AtomItem): boolean => a.max > a.min;
const isWide = (a: AtomItem): boolean =>
  isChoice(a) && (!Number.isFinite(a.max) || a.max - a.min + 1 > WIDE_EXTENTS);

/** Inlines single-alternative groups, which are transparent to matching and fencing. */
function flatten(alts: Item[][]): Item[][] {
  return alts.map((seq) =>
    seq.flatMap((item): Item[] => {
      if (item.kind !== "group") return [item];
      const inner = flatten(item.alts);
      return inner.length === 1 ? inner[0] : [{ kind: "group", alts: inner }];
    }),
  );
}

/** The item at `i` is a quantified atom whose next item is a mandatory atom of a disjoint set: one viable extent. */
function isFenced(seq: Item[], i: number): boolean {
  const item = seq[i];
  const next = seq[i + 1];
  return (
    item.kind === "atom" &&
    next !== undefined &&
    next.kind === "atom" &&
    next.min >= 1 &&
    disjointSets(item.set, next.set)
  );
}

/** How a wide atom weighs: 1 for the backtracking rules, `max(1, min)` for the HEL-1697 per-start work (its mandatory part). */
type WideWeight = (a: AtomItem) => number;
const ONE: WideWeight = () => 1;
const BY_MIN: WideWeight = (a) => Math.max(1, a.min);

function weightOf(item: Item, wide: WideWeight): number {
  switch (item.kind) {
    case "atom":
      return isWide(item) ? wide(item) : item.max;
    case "anchor":
      return item.dollar ? DOLLAR_WEIGHT : 0;
    case "group":
      return altsWeight(item.alts, wide);
  }
}
const seqWeight = (seq: Item[], wide: WideWeight, from = 0): number =>
  seq.slice(from).reduce((sum, item) => sum + weightOf(item, wide), 0);
const altsWeight = (alts: Item[][], wide: WideWeight = ONE): number =>
  Math.max(...alts.map((seq) => seqWeight(seq, wide)));

function seqPaths(seq: Item[]): number {
  let paths = 1;
  seq.forEach((item, i) => {
    if (item.kind === "group") paths *= altsPaths(item.alts);
    else if (item.kind === "atom" && isChoice(item) && !isWide(item) && !isFenced(seq, i))
      paths *= item.max - item.min + 1;
  });
  return paths;
}
const altsPaths = (alts: Item[][]): number => alts.reduce((sum, seq) => sum + seqPaths(seq), 0);

interface WideRef {
  fenced: boolean;
  /** Some item follows it in its branch, counting after its enclosing groups (anchors included). */
  hasNext: boolean;
  /** Weight of everything that can follow it in its branch, including after its enclosing groups. */
  tail: number;
}

/** Every wide quantifier in document order. */
function collectWides(alts: Item[][], after: number, out: WideRef[], outerNext = false): void {
  for (const seq of alts) {
    seq.forEach((item, i) => {
      const tail = seqWeight(seq, ONE, i + 1) + after;
      const hasNext = outerNext || i + 1 < seq.length;
      if (item.kind === "group") collectWides(item.alts, tail, out, hasNext);
      else if (item.kind === "atom" && isWide(item))
        out.push({ fenced: isFenced(seq, i), hasNext, tail });
    });
  }
}

const hasAlternation = (alts: Item[][]): boolean =>
  alts.length > 1 ||
  alts.some((seq) => seq.some((item) => item.kind === "group" && hasAlternation(item.alts)));

/** False when the pattern could backtrack super-linearly per start position (see design D2). */
export function isBacktrackBounded(root: Item[][]): boolean {
  const alts = flatten(root);
  const wides: WideRef[] = [];
  collectWides(alts, 0, wides);
  // Rule W: several wide quantifiers are safe only without alternation and with every one but the last fenced.
  if (wides.length >= 2 && (hasAlternation(alts) || wides.slice(0, -1).some((w) => !w.fenced)))
    return false;
  // Rule N: cost of the narrow choices, and of the tail an unfenced wide quantifier re-runs per retry.
  const paths = altsPaths(alts);
  if (paths > 1 && paths * Math.max(1, altsWeight(alts)) > MAX_COST) return false;
  return wides.every((w) => w.fenced || paths * Math.max(1, w.tail) <= MAX_TAIL_COST);
}

/** Atoms with more ranges than this make the pattern `unsafeRegex` (design D1 addendum 2). */
export const MAX_CLASS_RANGES = 64;

/**
 * HEL-1697 -- how much slower V8 tests a character against a class of `r` ranges than against a narrow one: a step function
 * calibrated in `.concertino/runs/HEL-1697/evidence/regex-work-calibration.md` (class-width section).
 */
export function classFactor(r: number): number {
  if (r <= 8) return 1;
  if (r <= 16) return CLASS_FACTORS[0];
  if (r <= 32) return CLASS_FACTORS[1];
  return CLASS_FACTORS[2];
}
const CLASS_FACTORS = [1.75, 2, 2] as const;

/**
 * HEL-1697 -- the constants of the predicted-work model (design D1 and addenda 2-4). Per input cell of `len` UTF-16 units:
 * `f x (A x len + sum over maximal runs R of characters in `chars` of (R x A x min(R, W) + m x R^2))`. `A` is the number of
 * alternative paths (each tries its leading item at every position), `W` the per-start-position work of one path (counted
 * atoms and a wide atom's `min` included, at least 1), `m` the multiplier for a wide quantifier that has further items
 * after it (whose tail is re-run per give-back), `f` the class-width factor of the widest atom, and `chars` the union of
 * every atom's set (a start position outside it fails at once). Only meaningful for a pattern `isBacktrackBounded` accepted.
 *
 * HEL-1807 -- `anchored`: every top-level alternative starts with `^` (no multiline: `(?m)` is declined), so V8 makes one match
 * attempt per cell, at position 0, and the cell is charged for that attempt alone (`regexInputCost.ts`). Calibrated in
 * `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/calibration.md`.
 */
export interface RegexWork {
  A: number;
  W: number;
  m: number;
  f: number;
  chars: Ranges;
  anchored: boolean;
}

/**
 * Whether every alternative of the flattened tree starts with `^`, directly or through a group whose alternatives all do. An
 * alternative with a consuming item before the `^` (`(a)^b`), with no item (`^a|`) or a `$` first is tried at every position.
 */
function startAnchored(alts: Item[][]): boolean {
  return alts.every((seq) => {
    const first = seq[0];
    if (first === undefined) return false;
    if (first.kind === "anchor") return !first.dollar;
    return first.kind === "group" && startAnchored(first.alts);
  });
}

function atomSets(alts: Item[][], out: Ranges[]): void {
  for (const seq of alts)
    for (const item of seq) {
      if (item.kind === "atom") out.push(item.set);
      else if (item.kind === "group") atomSets(item.alts, out);
    }
}

/** The range count of the widest atom set of the pattern. */
export function widestClass(root: Item[][]): number {
  const sets: Ranges[] = [];
  atomSets(root, sets);
  return Math.max(0, ...sets.map((set) => set.length));
}

export function regexWorkModel(root: Item[][]): RegexWork {
  const alts = flatten(root);
  const paths = altsPaths(alts);
  const wides: WideRef[] = [];
  collectWides(alts, 0, wides);
  const sets: Ranges[] = [];
  atomSets(alts, sets);
  return {
    A: paths,
    W: Math.max(1, altsWeight(alts, BY_MIN)),
    m: Math.max(0, ...wides.filter((w) => w.hasNext).map((w) => paths * Math.max(1, w.tail))),
    f: classFactor(widestClass(alts)),
    chars: unionSets(sets),
    anchored: startAnchored(alts),
  };
}
