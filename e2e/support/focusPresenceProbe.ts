// HEL-520 — shared measurement core for the AC2 focus-presence guard
// (focus-presence-guard.spec.ts) and its regression harness
// (hel520-focus-presence-guard.regression.spec.ts), on the
// touchTargetProbe.ts/HEL-813 pattern: one module both specs import, so
// "the same measurement logic goes red on the known-bad shape" is
// guaranteed by import, not just asserted in prose (design.md D6).
import { classifyState, compositeStack, parseColor } from "./stateContrast.mjs";

// HEL-520 CR1 (evaluation-1.md) — the enforced floor is 3.0, WCAG 2.1 SC
// 1.4.11's non-text-contrast requirement, NOT `stateContrast.mjs`'s
// `CONTRAST_THRESHOLD` (1.1). That constant's own header comment
// disclaims exactly this use: "NOT a WCAG text-legibility threshold... no
// adjacent-surface pair in this theme, good or bad, comes close to WCAG's
// 3:1/4.5:1" — it was derived for HEL-866's hover-SURFACE question, a
// "measurably different" bar, not a focus indicator's legibility bar.
// design.md D1c, tasks.md 2.1, and the accessible-focus-indicator spec
// delta all say "the 3:1 non-text floor" — this constant makes the code
// match every artifact that describes it (branch (a) of CR1, per the
// orchestrator's explicit steer).
const FOCUS_NONTEXT_CONTRAST_THRESHOLD = 3.0;

export interface RawIndicator {
  outlineColor: string;
  outlineStyle: string;
  outlineWidth: number;
  outlineOffset: number;
  boxShadow: string;
  borderColor: string;
  backgroundColor: string;
}

export interface ElementRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface IndicatorSnapshot {
  rect: ElementRect;
  raw: RawIndicator;
}

type EvaluableHandle = {
  evaluate: <R>(fn: (el: Element, arg?: unknown) => R, arg?: unknown) => Promise<R>;
};

/** Reads the raw indicator-relevant computed-style channels for `handle`'s
 *  element, plus its rendered box — used once unforced (base) and once
 *  with `:focus-visible` CDP-forced (forced), so presence is decided by
 *  DIFFING rendered state, never by reading a declaration in isolation
 *  (design.md D2, MISTAKES.md/HEL-1060: a bare presence read is vacuous
 *  under theme.css:449's global rule). */
export async function readIndicatorSnapshot(handle: EvaluableHandle): Promise<IndicatorSnapshot> {
  return handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return {
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      raw: {
        outlineColor: s.outlineColor,
        outlineStyle: s.outlineStyle,
        outlineWidth: parseFloat(s.outlineWidth) || 0,
        outlineOffset: parseFloat(s.outlineOffset) || 0,
        boxShadow: s.boxShadow,
        borderColor: s.borderColor,
        backgroundColor: s.backgroundColor,
      },
    };
  });
}

/** Parses the spread radius out of a plain `0px 0px 0px Npx <color>` box-
 *  shadow (this app's halo convention, e.g. inputs.css's `0 0 0 3px
 *  var(--app-accent-dim)`) — returns null for `"none"` or any shape this
 *  app doesn't use (an offset/blur shadow), in which case the caller
 *  conservatively treats the ring band as unexpanded rather than guessing. */
export function parseHaloSpread(boxShadow: string): number | null {
  if (boxShadow === "none") return null;
  // Chromium's computed-style serialization is colour-first regardless of
  // source order; the colour itself takes one of the same three shapes
  // stateContrast.mjs's own parseColor documents (`rgba?(...)`, or
  // `color(srgb ...)` for a resting color-mix() result, e.g. this app's
  // --app-accent-dim/--app-error-surface halo tokens) — confirmed live
  // against inputs.css's `box-shadow: 0 0 0 3px var(--app-accent-dim)`.
  const m = boxShadow.match(/^(?:rgba?\([^)]*\)|color\([^)]*\))\s+0px\s+0px\s+0px\s+([\d.]+)px$/);
  if (m) return parseFloat(m[1]);
  return null;
}

/** Extracts the leading colour token from a box-shadow string, matching
 *  either `rgba?(...)` or `color(...)` — same two shapes `parseHaloSpread`
 *  recognizes above, kept as a separate function only because the caller
 *  needs the colour text (to hand to stateContrast.mjs's parseColor)
 *  rather than the spread number. */
export function parseHaloColor(boxShadow: string): string | null {
  const m = boxShadow.match(/^(rgba?\([^)]*\)|color\([^)]*\))\s+0px\s+0px\s+0px\s+[\d.]+px$/);
  return m ? m[1] : null;
}

export interface AncestorBox extends ElementRect {
  clipsX: boolean;
  clipsY: boolean;
}

/** Walks `el`'s ancestor chain collecting each ancestor's own clipping box
 *  (only ancestors whose computed overflow actually clips are included —
 *  design.md D2/2.3). Read inside a single `evaluate` per element to avoid
 *  N round trips. */
export async function readAncestorClipBoxes(handle: EvaluableHandle): Promise<AncestorBox[]> {
  return handle.evaluate((el) => {
    const boxes: AncestorBox[] = [];
    let node: Element | null = el.parentElement;
    let guard = 0;
    while (node && guard < 64) {
      guard++;
      const s = window.getComputedStyle(node);
      const clipsX = s.overflowX === "hidden" || s.overflowX === "clip";
      const clipsY = s.overflowY === "hidden" || s.overflowY === "clip";
      if (clipsX || clipsY) {
        const r = node.getBoundingClientRect();
        boxes.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, clipsX, clipsY });
      }
      node = node.parentElement;
    }
    return boxes;
  });
}

// Task 2.4 — occlusion, deliberately not shipped. A `document.
// elementsFromPoint`-based sampler (force focus, sample the ring band's
// outward extension points, check whether the topmost hit-tested element
// is `el` or an unrelated sibling) was implemented and run against the
// live app. It produced a confirmed FALSE POSITIVE: `.app-skip-link`'s
// outline ring, correctly stacked above `.app-command-bar` by z-index
// (App.css), still sampled as "100% occluded" — because neither `outline`
// nor `box-shadow` ever expands an element's HIT-TEST box; both are
// paint-only effects. `elementsFromPoint` therefore returns whatever sits
// underneath in DOM hit-test geometry at a ring-band point, regardless of
// which element's paint actually wins that pixel — it cannot distinguish
// "painted behind a sibling" (the real HEL-520 defect this check exists to
// catch) from "correctly painted on top of something unclickable" (the
// normal case for nearly every ring in this app). A sound version needs
// real paint-order resolution (z-index/stacking-context comparison, or
// pixel-level screenshot diffing), which this cycle's remaining budget
// does not cover. Reported as an incomplete task in files-modified.md, not
// silently downgraded to "found nothing" or shipped with a known-unsound
// detector.

export interface Backdrop {
  layers: { bg: string }[];
  resolved: boolean;
}

/** Same ancestor-walk-and-accumulate-alpha backdrop resolution the sibling
 *  HEL-866 guard uses (state-surface-contrast-guard.spec.ts's
 *  `readBackdrop`) — re-implemented here rather than imported because
 *  that function is module-local to that spec (not extracted; unlike
 *  `forceFocusVisible`, this ticket's tasks did not name it for
 *  extraction, and duplicating ~25 lines of a well-understood ancestor
 *  walk is a smaller divergence risk than adding a second export surface
 *  this cycle wasn't asked to reason through). Logic is identical; see
 *  that file's comments for the full derivation. */
export async function readBackdrop(handle: EvaluableHandle): Promise<Backdrop> {
  return handle.evaluate((el) => {
    const layers: { bg: string }[] = [];
    let node: Element | null = el.parentElement;
    let resolved = false;
    let guard = 0;
    while (node && guard < 64) {
      guard++;
      const style = window.getComputedStyle(node);
      if (style.opacity !== "" && parseFloat(style.opacity) < 1) {
        return { layers, resolved: false };
      }
      const bgColorHere = style.backgroundColor;
      const hasOpaqueishColor =
        bgColorHere && bgColorHere !== "rgba(0, 0, 0, 0)" && bgColorHere !== "transparent";
      if (style.backgroundImage && style.backgroundImage !== "none" && hasOpaqueishColor) {
        return { layers, resolved: false };
      }
      const bg = style.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        layers.push({ bg });
        if (/^rgb\(/.test(bg.trim())) {
          resolved = true;
          break;
        }
      }
      node = node.parentElement;
    }
    return { layers, resolved };
  });
}

// CR3 (evaluation-1.md) — "occluded" removed: it was a dead, unreachable
// member (no producer — see the module comment above explaining why
// occlusion detection itself was never shipped). A Verdict this guard
// cannot ever produce is a false claim of coverage, not documentation.
export type Verdict = "pass" | "fail" | "clipped" | "no-indicator" | "unresolved-backdrop";

export interface Finding {
  view: string;
  theme: string;
  desc: string;
  verdict: Verdict;
  detail: string;
}

/** Runs the forced-state read through to a final `Finding` for one
 *  already real-focused-and-CDP-forced element. MUST be called while the
 *  element is still focused (the caller clears focus in a `finally` after
 *  this returns) — every measurement here (the forced snapshot, ancestor
 *  clip boxes, backdrop walk) reads the currently-revealed DOM state,
 *  which an ancestor `:focus-within` reveal rule depends on. */
export async function measureOneElement(
  handle: EvaluableHandle,
  base: IndicatorSnapshot,
  viewName: string,
  theme: string,
  desc: string,
): Promise<Finding> {
  const forced = await readIndicatorSnapshot(handle);

  const outlineChanged =
    forced.raw.outlineStyle !== "none" &&
    forced.raw.outlineWidth > 0 &&
    (forced.raw.outlineColor !== base.raw.outlineColor ||
      forced.raw.outlineStyle !== base.raw.outlineStyle ||
      forced.raw.outlineWidth !== base.raw.outlineWidth);
  const shadowChanged = forced.raw.boxShadow !== base.raw.boxShadow;
  const borderChanged = forced.raw.borderColor !== base.raw.borderColor;
  const bgChanged = forced.raw.backgroundColor !== base.raw.backgroundColor;

  if (!outlineChanged && !shadowChanged && !borderChanged && !bgChanged) {
    return {
      view: viewName,
      theme,
      desc,
      verdict: "no-indicator",
      detail: "no outline/box-shadow/border/background channel changed under forced focus-visible",
    };
  }

  // evaluation-2.md CR-A — ANY-CHANGED-CHANNEL rule, not precedence. The
  // precedence rule this replaced (`outline > box-shadow > border`) graded
  // exactly one channel per element: `.ui-input`'s shared rule sets
  // `outline: none` PLUS a real, contrast-derived `border-color` PLUS a
  // deliberately decorative `box-shadow` halo — outline is always "none"
  // there, so precedence fell through to the halo and never measured the
  // border, the channel actually carrying the conforming indicator.
  // Measured live: the border alone clears the 3:1 floor (4.96 dark /
  // 3.48 light) while the halo alone does not (1.14 / 1.08) — the exact
  // ratios `KNOWN_RESIDUAL_RATIOS` used to name as an accepted residual,
  // which that finding retracts (see files-modified.md). The corrected
  // rule collects EVERY channel that changed, measures each independently
  // (each with its own ring band / clip check, since only outline and
  // box-shadow extend outward), and passes if ANY channel clears the
  // floor — reporting that channel's ratio. Deliberately NOT "prefer
  // border over box-shadow" instead: that is the same single-channel bug
  // pointed the other way, and would misgrade a site where the shadow (not
  // the border) is the real, only conforming indicator.
  //
  // evaluation-3.md — LATENT, MEASURED, CONSCIOUSLY ACCEPTED HOLE (not a
  // fix; documented so a future reader doesn't rediscover it as new).
  // Each candidate is graded on its channel's ABSOLUTE contrast against
  // the backdrop, not the MAGNITUDE of its change from rest — so, in
  // principle, a 1/255 background shift on an already-high-contrast
  // element could be credited as a passing "indicator" it never actually
  // presented. This is inherited unchanged from the old precedence rule's
  // final `else` branch (the background fallback), not introduced by the
  // any-channel change. The evaluator swept 50 focusable elements across
  // `/` and `/settings` and found the live distribution of which channel
  // changed: outline 47, box-shadow 11, border 3, background 2, none 0 —
  // and ZERO elements were rescued only by a border or background
  // candidate (every element that changed a border or background also
  // changed an outline or box-shadow — the sweep recorded which channels
  // CHANGED, not which candidates passed). Measured at zero exposure
  // today; owned by HEL-1063 if extending coverage changes that; left
  // unaddressed as a known, named gap rather than fixed reflexively or
  // silently left undiscovered.
  interface Candidate {
    label: string;
    bandExpand: number;
    channelColor: string;
  }
  const candidates: Candidate[] = [];
  const parseErrors: string[] = [];

  if (outlineChanged) {
    // Outline geometry: the ring's outer edge sits at `border edge +
    // outlineOffset + outlineWidth`; its outward reach past the border
    // edge is therefore `outlineWidth + outlineOffset`, clamped at 0 for
    // a negative offset large enough to pull the whole ring inside the
    // box (e.g. offset=-2/width=2 -- DESIGN.md §8's own flush-fitting-
    // child carve-out -- reaches 0, not `outlineWidth`). Confirmed live:
    // the earlier `outlineWidth + Math.max(outlineOffset, 0)` form
    // overstated this case's reach as 2px instead of 0px, producing a
    // false "clipped" 2px past a container's exact edge for a button
    // using exactly that carve-out (regression harness Case B).
    candidates.push({
      label: "outline",
      bandExpand: Math.max(0, forced.raw.outlineWidth + forced.raw.outlineOffset),
      channelColor: forced.raw.outlineColor,
    });
  }
  if (shadowChanged) {
    const spread = parseHaloSpread(forced.raw.boxShadow);
    if (spread === null) {
      parseErrors.push(
        `unrecognized box-shadow shape for spread extraction: "${forced.raw.boxShadow}"`,
      );
    } else {
      candidates.push({
        label: "box-shadow",
        bandExpand: spread,
        channelColor: parseHaloColor(forced.raw.boxShadow) ?? forced.raw.borderColor,
      });
    }
  }
  if (borderChanged) {
    candidates.push({ label: "border", bandExpand: 0, channelColor: forced.raw.borderColor });
  }
  if (bgChanged) {
    candidates.push({
      label: "background",
      bandExpand: 0,
      channelColor: forced.raw.backgroundColor,
    });
  }

  if (candidates.length === 0) {
    // Every changed channel failed to parse (e.g. only an unrecognized
    // box-shadow shape changed) — unresolved, not silently "no-indicator".
    return {
      view: viewName,
      theme,
      desc,
      verdict: "unresolved-backdrop",
      detail: parseErrors.join("; ") || "no measurable channel changed",
    };
  }

  // The FORCED rect, not `base.rect`: an element revealed by an ancestor
  // `:focus-within` rule (see the caller's comment) changes size between
  // rest and focused (e.g. 1x1 -> 24x24), and each candidate's ring band
  // must be positioned against where it actually paints while focused.
  const elementBox = forced.rect;
  let ancestorBoxesCache: AncestorBox[] | null = null;
  async function isClipped(bandExpand: number): Promise<string | null> {
    if (bandExpand === 0) return null; // painted at the element's own edge — nothing to clip
    if (ancestorBoxesCache === null) {
      ancestorBoxesCache = await readAncestorClipBoxes(handle);
    }
    const band = {
      left: elementBox.left - bandExpand,
      top: elementBox.top - bandExpand,
      right: elementBox.right + bandExpand,
      bottom: elementBox.bottom + bandExpand,
    };
    for (const a of ancestorBoxesCache) {
      if (a.clipsX && (band.left < a.left || band.right > a.right)) {
        return `clipped on X by ancestor box [${a.left.toFixed(1)},${a.right.toFixed(1)}]`;
      }
      if (a.clipsY && (band.top < a.top || band.bottom > a.bottom)) {
        return `clipped on Y by ancestor box [${a.top.toFixed(1)},${a.bottom.toFixed(1)}]`;
      }
    }
    return null;
  }

  // Contrast (D1c): compose the backdrop and each candidate channel's
  // colour, classify with stateKind: "focus" so an outline/border/shadow-
  // only channel is ratio-enforced rather than deferred. Computed once
  // and reused across candidates (the backdrop doesn't vary per channel).
  const backdrop = await readBackdrop(handle);
  if (!backdrop.resolved) {
    return {
      view: viewName,
      theme,
      desc,
      verdict: "unresolved-backdrop",
      detail: "ancestor walk never reached a fully opaque rgb() background",
    };
  }
  const backdropLayers = backdrop.layers.map((l) => parseColor(l.bg));
  const backdropOpaque = compositeStack(backdropLayers);

  let bestRatio: number | null = null;
  let bestPassed = false;
  const clippedLabels: string[] = [];
  const unresolvedDetails: string[] = [...parseErrors];

  for (const candidate of candidates) {
    const clipReason = await isClipped(candidate.bandExpand);
    if (clipReason) {
      clippedLabels.push(`${candidate.label}: ${clipReason}`);
      continue;
    }
    let indicatorOpaque;
    try {
      indicatorOpaque = compositeStack([parseColor(candidate.channelColor), backdropOpaque]);
    } catch {
      unresolvedDetails.push(
        `could not parse ${candidate.label} colour "${candidate.channelColor}"`,
      );
      continue;
    }
    const { verdict: classified, ratio } = classifyState({
      backgroundChanged: false,
      otherChannelChanged: true,
      backdrop: backdropOpaque,
      stateColor: indicatorOpaque,
      stateKind: "focus",
      threshold: FOCUS_NONTEXT_CONTRAST_THRESHOLD,
    });
    if (ratio !== null && (bestRatio === null || ratio > bestRatio)) {
      bestRatio = ratio;
    }
    if (classified === "pass") {
      bestPassed = true;
    }
  }

  if (bestRatio !== null) {
    return {
      view: viewName,
      theme,
      desc,
      verdict: bestPassed ? "pass" : "fail",
      detail: `ratio=${bestRatio}`,
    };
  }

  // No candidate produced a ratio: every changed channel was either
  // clipped or unparseable. Clipping takes priority in the report — it is
  // the more specific, actionable finding.
  if (clippedLabels.length > 0) {
    return { view: viewName, theme, desc, verdict: "clipped", detail: clippedLabels.join("; ") };
  }
  return {
    view: viewName,
    theme,
    desc,
    verdict: "unresolved-backdrop",
    detail: unresolvedDetails.join("; ") || "no channel produced a measurable ratio",
  };
}
