// Pure layout geometry for the per-breakpoint dashboard grid (HEL-1023). No React, no Redux.
//
// The overlap predicate and the validity contract (`x >= 0`, `w >= 1`, `h >= 1`, `x + w <= cols`, no
// two items overlapping) are deliberately small and standalone so a server-side validator (HEL-1071)
// can mirror them exactly.

import type { DashboardLayoutItem } from "../types/dashboard";

type Item = DashboardLayoutItem;

/** Breakpoints widest to narrowest; the index distance defines "nearest". */
export const breakpointOrder = ["lg", "md", "sm", "xs"] as const;
export type BreakpointKey = (typeof breakpointOrder)[number];

/** True when two items share any grid cell. Touching edges do not overlap. */
export function rectsOverlap(a: Item, b: Item): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Every overlapping pair, in input order (`[earlier, later]`). */
export function findOverlaps(items: readonly Item[]): [Item, Item][] {
  const pairs: [Item, Item][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (rectsOverlap(items[i], items[j])) pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

/** True when `item` lies inside a `cols`-column grid with positive size. */
export function isItemInBounds(item: Item, cols: number): boolean {
  return item.x >= 0 && item.y >= 0 && item.w >= 1 && item.h >= 1 && item.x + item.w <= cols;
}

/** The validity contract: every item in bounds and no two items overlapping. */
export function isLayoutValid(items: readonly Item[], cols: number): boolean {
  return items.every((item) => isItemInBounds(item, cols)) && findOverlaps(items).length === 0;
}

/** Proportionally scales one item's `x`/`w` from `sourceCols` to `targetCols`, clamping `w` to
 * `[1, targetCols]` and `x` to `[0, targetCols - w]`. `y`/`h` are row-based and carry over. */
export function scaleLayoutItem(item: Item, sourceCols: number, targetCols: number): Item {
  const scale = targetCols / sourceCols;
  const w = Math.max(1, Math.min(targetCols, Math.round(item.w * scale)));
  const x = Math.max(0, Math.min(targetCols - w, Math.round(item.x * scale)));
  return { panelId: item.panelId, x, y: item.y, w, h: item.h };
}

function clampItem(item: Item, cols: number): Item {
  const w = Math.max(1, Math.min(cols, item.w));
  return {
    panelId: item.panelId,
    x: Math.max(0, Math.min(cols - w, item.x)),
    y: Math.max(0, item.y),
    w,
    h: Math.max(1, item.h),
  };
}

/** Smallest `y >= fromY` at which `item` (kept at its own x) collides with nothing in `placed`. */
function firstFreeY(placed: readonly Item[], item: Item, fromY: number): number {
  const candidates = new Set<number>([fromY]);
  for (const other of placed) if (other.y + other.h > fromY) candidates.add(other.y + other.h);
  for (const y of [...candidates].sort((a, b) => a - b)) {
    if (!placed.some((other) => rectsOverlap({ ...item, y }, other))) return y;
  }
  // Unreachable: the largest candidate sits below every placed item.
  return Math.max(fromY, ...placed.map((other) => other.y + other.h));
}

/** Places `movable` one by one into the free space around `fixed`, each at its own x and at the first
 * free row at or below its own y. `fixed` items never move. Returns the movable items only. */
export function placeAround(
  fixed: readonly Item[],
  movable: readonly Item[],
  cols: number,
): Item[] {
  const placed = [...fixed];
  const out: Item[] = [];
  for (const raw of movable) {
    const item = clampItem(raw, cols);
    const next = { ...item, y: firstFreeY(placed, item, item.y) };
    placed.push(next);
    out.push(next);
  }
  return out;
}

/** One compaction sweep: items in reading order (y, x, input index); each keeps its x and takes the
 * smallest y that collides with nothing already placed and never rises above the item placed before it,
 * so a later item cannot jump over an earlier row. Returns items in INPUT order. */
function compactOnce(items: readonly Item[]): Item[] {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x || a.index - b.index);
  const placed: Item[] = [];
  const result = new Array<Item>(items.length);
  let floor = 0;
  for (const { item, index } of order) {
    const y = firstFreeY(placed, item, floor);
    const next = { ...item, y };
    placed.push(next);
    result[index] = next;
    floor = y;
  }
  return result;
}

/** Clamps every item into `cols`, then removes overlaps by sliding items down (see `compactOnce`),
 * repeating until the layout is stable: a sweep can re-order equal-y neighbours, so a single sweep is
 * not idempotent on its own, and the fixpoint is. The pass count is capped by the item count (observed
 * to converge well inside it; the property test in breakpointLayout.test.ts guards idempotence).
 * Returns items in INPUT order. */
export function compactLayout(items: readonly Item[], cols: number): Item[] {
  let current = items.map((item) => clampItem(item, cols));
  for (let pass = 0; pass <= items.length; pass++) {
    const next = compactOnce(current);
    if (next.every((item, i) => item.y === current[i].y)) return next;
    current = next;
  }
  return current;
}

/** The other breakpoints ordered nearest-first to `target`; ties prefer the wider breakpoint. */
export function nearestAuthoredBreakpoint(
  target: BreakpointKey,
  candidates: readonly BreakpointKey[],
): BreakpointKey[] {
  const index = (bp: BreakpointKey) => breakpointOrder.indexOf(bp);
  return candidates
    .filter((bp) => bp !== target)
    .sort(
      (a, b) =>
        Math.abs(index(a) - index(target)) - Math.abs(index(b) - index(target)) ||
        index(a) - index(b),
    );
}
