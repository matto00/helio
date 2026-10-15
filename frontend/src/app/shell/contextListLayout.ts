/** Context-list width contract (owner ruling 2026-10-13): min 200 / default 248 / max 400 px. */
export const CONTEXT_LIST_MIN_WIDTH = 200;
export const CONTEXT_LIST_DEFAULT_WIDTH = 248;
export const CONTEXT_LIST_MAX_WIDTH = 400;

/** Arrow-key step, and the Shift-modified step, for the separator. */
export const CONTEXT_LIST_KEY_STEP = 16;
export const CONTEXT_LIST_KEY_STEP_LARGE = 64;

/** The rail is 56px wide (DESIGN.md §9). */
export const RAIL_WIDTH = 56;

export function clampContextListWidth(width: number): number {
  if (!Number.isFinite(width)) return CONTEXT_LIST_DEFAULT_WIDTH;
  return Math.min(CONTEXT_LIST_MAX_WIDTH, Math.max(CONTEXT_LIST_MIN_WIDTH, Math.round(width)));
}

/** Where keyboard focus goes after the list collapses or expands. Collapsing or expanding unmounts the focused control
 *  (the separator, the header's Collapse button, or the rail's Expand button), which would drop focus on `<body>`.
 *  The toggle records where focus should land; the control that mounts as a result claims it. */
export type ListFocusTarget = "expand-button" | "collapse-button";

let pendingFocus: ListFocusTarget | null = null;

export function requestListFocus(target: ListFocusTarget): void {
  pendingFocus = target;
}

/** True exactly once for the requested target, so only the control that just mounted takes focus. */
export function takeListFocus(target: ListFocusTarget): boolean {
  if (pendingFocus !== target) return false;
  pendingFocus = null;
  return true;
}
