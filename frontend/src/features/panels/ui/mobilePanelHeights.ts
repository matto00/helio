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

import type { PanelKind } from "../types/panel";

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

/** metric: content-sized, ~104–132px; `h` is ignored entirely (W4.3). */
const METRIC_HEIGHT_PX = 120;

/** chart: aspect-driven `clamp(200, w × 0.62, 340)`, modulated by `h`. */
const CHART_MIN_HEIGHT_PX = 200;
const CHART_MAX_HEIGHT_PX = 340;
const CHART_WIDTH_ASPECT_RATIO = 0.62;
const CHART_COMPACT_H = 4;
const CHART_TALL_H = 8;
/** How far the compact/tall ends pull away from the width-driven aspect
 *  height. At phone content widths (~344–358px) the aspect height is only
 *  ~213–222px — well under CHART_MAX_HEIGHT_PX — so in practice `h` nudges
 *  within a narrower band than the full [200,340] range. If device feedback
 *  wants `h` to matter more, widen these factors first. */
const CHART_H_COMPACT_FACTOR = 0.85;
const CHART_H_TALL_FACTOR = 1.15;

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

function computeChartHeight(h: number, w: number): number {
  const aspectHeight = clampNumber(
    w * CHART_WIDTH_ASPECT_RATIO,
    CHART_MIN_HEIGHT_PX,
    CHART_MAX_HEIGHT_PX,
  );
  const t = clampNumber((h - CHART_COMPACT_H) / (CHART_TALL_H - CHART_COMPACT_H), 0, 1);
  const factor = CHART_H_COMPACT_FACTOR + t * (CHART_H_TALL_FACTOR - CHART_H_COMPACT_FACTOR);
  return Math.round(clampNumber(aspectHeight * factor, CHART_MIN_HEIGHT_PX, CHART_MAX_HEIGHT_PX));
}

/** Maps a panel's kind, stored `h`, and resolved content width to the phone
 *  stack's height policy (W4.3). `w` is the panel's *content* width, not the
 *  raw grid-container width — callers resolve it via
 *  `resolveStackContentWidth` first. */
export function computeMobilePanelHeight(
  kind: PanelKind,
  h: number,
  w: number,
): MobilePanelHeightPolicy {
  switch (kind) {
    case "metric":
      return { height: METRIC_HEIGHT_PX, scrollsInternally: false };
    case "chart":
      return { height: computeChartHeight(h, w), scrollsInternally: false };
    case "table":
      // Capped via CSS (`min(60dvh, intrinsic)`); the only stack kind with an
      // internal scroller.
      return { height: null, scrollsInternally: true };
    case "markdown":
    case "text":
    case "image":
    case "divider":
      return { height: null, scrollsInternally: false };
  }
}
