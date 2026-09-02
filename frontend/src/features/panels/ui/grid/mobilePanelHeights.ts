// Per-kind panel height policy for the phone read-only stack (HEL-301, W4.3
// of notes/mobile-pwa-handoff.md — the binding spec). Pure and unit-testable
// so device-tuning after the handoff's §6 device-testing round is a one-file
// change: every constant an evaluator/owner might want to retune lives here,
// nowhere else.
//
// The desktop grid's `h × rowHeight` formula encodes intent inside a
// 12-column grid; that proportion does not survive being stretched to a
// full-width phone column (W4.2 — "the biggest 'this is just the website'
// tell in the app"). Below, `h` only *modulates* within a clamped,
// content-appropriate band per kind — it is never multiplied by a row
// height.

import type { PanelKind } from "../../types/panel";

export interface MobilePanelHeightPolicy {
  /** Fixed pixel height to apply via the `--mobile-panel-height` custom
   *  property, or `null` when the kind is fully intrinsic (no forced
   *  height — the card sizes to its content). */
  height: number | null;
  /** True only for `table` — the sole kind allowed a nested scroll
   *  container in the stack ("only table gets one", W4.3). */
  scrollsInternally: boolean;
}

// ── Tuning knobs — starting values, expected to change after device testing
//    (see files-modified.md's device test plan). Nothing outside this file
//    needs to change to retune sizing. ──────────────────────────────────────

// HEL-909: the per-kind metric/chart height math (aspect-ratio-driven chart
// sizing, fixed metric height) was retired along with the bound-trio panel
// kinds — an `output` placement's rendered content kind is not visible to
// this function today (see `computeMobilePanelHeight`'s doc comment). The
// constants and `computeChartHeight` helper that implemented it are removed
// wholesale rather than left as dead code; recover them from git history
// (this file, pre-HEL-909) if/when output-kind-aware sizing is threaded
// through.

// table: capped at `min(60dvh, intrinsic)` — applied in MobilePanelStack.css
// (`.mobile-panel-stack__item--table .panel-content--table`), not here;
// there is no meaningful pixel value to precompute without a live viewport.

/** Chrome subtracted from the measured stack-container width to approximate
 *  a single stack item's content width: the stack's own `--space-3`
 *  container padding (both sides, 2×12px) plus `.panel-grid-card`'s own
 *  internal padding (both sides, `clamp(14px, 2vw, 20px)`, ~16px typical at
 *  phone widths). Approximate by design (W4.3: "these numbers were derived
 *  by reading code... tune them on device") — not worth a live per-item
 *  ResizeObserver when every item in a single-column stack shares one width. */
const STACK_CONTAINER_PADDING_PX = 24; // 2 × --space-3 (12px)
const STACK_CARD_PADDING_PX = 32; // 2 × ~16px card padding
const STACK_ITEM_CHROME_PX = STACK_CONTAINER_PADDING_PX + STACK_CARD_PADDING_PX;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Approximates a single stack item's content width from the measured grid
 *  container width. See `STACK_ITEM_CHROME_PX`. */
export function resolveStackContentWidth(containerWidth: number): number {
  return Math.max(0, containerWidth - STACK_ITEM_CHROME_PX);
}

/** Maps a panel's kind, stored `h`, and resolved content width to the phone
 *  stack's height policy (W4.3). `w` is the panel's *content* width, not the
 *  raw grid-container width — callers resolve it via
 *  `resolveStackContentWidth` first.
 *
 *  HEL-909: a placement is one of 5 kinds now (output/text/markdown/image/
 *  divider); an `output` panel's *rendered* content (metric/chart/table/
 *  collection/timeline/markdown) is a property of the fetched Output, not
 *  the placement, and is not available to this pure function today. Until a
 *  follow-up threads the resolved Output kind through, `output` gets the
 *  same "capped, internally-scrolling" treatment `table` had — the safest
 *  default for content whose intrinsic height can be arbitrarily large. See
 *  files-modified.md's punch list for the deferred output-kind-aware
 *  refinement. */
export function computeMobilePanelHeight(
  kind: PanelKind,
  h: number,
  w: number,
): MobilePanelHeightPolicy {
  switch (kind) {
    case "output":
      // Capped via CSS (`min(60dvh, intrinsic)`); the sole stack kind with an
      // internal scroller until output-kind-aware sizing lands. `h`/`w` are
      // unused for this kind today (see doc comment above).
      return { height: null, scrollsInternally: true };
    case "markdown":
    case "text":
    case "image":
    case "divider":
      return { height: null, scrollsInternally: false };
  }
}
