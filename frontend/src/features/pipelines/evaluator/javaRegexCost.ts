// HEL-1683 -- the backtracking check of the regex allowlist (design D2). A pattern the allowlist tokenizes is an alternation tree
// of sequences of items (groups are never quantified), so super-linear backtracking per start position can only come from
// several choice points trading the same characters. `isBacktrackBounded` is a static, conservative test: a `false` answer
// declines the pattern to the server, which evaluates it under its 2 s per-step regex time budget.

import { disjointSets, type Ranges } from "./javaRegexSets";

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

function weightOf(item: Item): number {
  switch (item.kind) {
    case "atom":
      return isWide(item) ? 1 : item.max;
    case "anchor":
      return item.dollar ? DOLLAR_WEIGHT : 0;
    case "group":
      return altsWeight(item.alts);
  }
}
const seqWeight = (seq: Item[], from = 0): number =>
  seq.slice(from).reduce((sum, item) => sum + weightOf(item), 0);
const altsWeight = (alts: Item[][]): number => Math.max(...alts.map((seq) => seqWeight(seq)));

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
  /** Weight of everything that can follow it in its branch, including after its enclosing groups. */
  tail: number;
}

/** Every wide quantifier in document order. */
function collectWides(alts: Item[][], after: number, out: WideRef[]): void {
  for (const seq of alts) {
    seq.forEach((item, i) => {
      const tail = seqWeight(seq, i + 1) + after;
      if (item.kind === "group") collectWides(item.alts, tail, out);
      else if (item.kind === "atom" && isWide(item)) out.push({ fenced: isFenced(seq, i), tail });
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
