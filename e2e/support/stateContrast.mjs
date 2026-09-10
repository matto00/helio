// HEL-866 — pure measurement core for the state-surface contrast guard.
//
// Deliberately plain, dependency-free functions with NO Playwright import,
// so the core can be exercised by a fast Node self-test
// (stateContrast.selftest.mjs, on the scripts/check-tokens.selftest.mjs
// pattern) without a browser, and imported unchanged by the rendered
// Playwright spec (state-surface-contrast-guard.spec.ts) that drives real
// pages. See openspec/changes/state-surface-contrast-guard/design.md D3/D4
// for the derivation of every constant and rule below.
//
// THRESHOLD DERIVATION (design.md D3, re-verified by skeptic-design-3.md):
// measured from frontend/src/theme/theme.css --
//   raised on strong (the known-broken pair): light 1.000, dark 1.040
//   soft   on strong (the remediation):       light 1.179, dark 1.167
// 1.10 sits in the gap: >=0.06 above the worst broken pair, >=0.067 below
// the worst good pair. This is a "measurably different" threshold, NOT a
// WCAG text-legibility threshold (no adjacent-surface pair in this theme,
// good or bad, comes close to WCAG's 3:1/4.5:1) -- see design.md D3.
export const CONTRAST_THRESHOLD = 1.1;

/**
 * @typedef {{ r: number, g: number, b: number, a: number }} RGBA
 */

/**
 * Parses a CSS colour string as returned by `getComputedStyle` into an
 * { r, g, b, a } object with r/g/b in [0, 255] and a in [0, 1]. Confirmed
 * against this app (not assumed) that Chromium's computed-style
 * serialization for this population takes THREE distinct shapes, all
 * handled here:
 *   - `rgb(r, g, b)` / `rgba(r, g, b, a)` -- the common case (plain colours,
 *     and any color-mix() result once fully settled).
 *   - `color(srgb r g b [/ a])` with r/g/b as 0-1 floats -- the resting
 *     serialization of a `color-mix(in srgb, ...)` result (this app's
 *     `--app-accent-surface`/`--app-accent-dim`), confirmed by direct probe
 *     against the running app.
 *   - `oklab(L a b [/ alpha])` -- a MID-TRANSITION interpolated colour
 *     (theme.css's `--app-transition: 0.16s ease` on `background-color`);
 *     Chromium serializes the live interpolation frame in oklab regardless
 *     of the declared colour space. This is NOT a colour this function
 *     tries to convert -- an interpolating value read mid-transition is not
 *     the state the guard means to measure, and design.md/D4 requires
 *     settling transitions before reading, not reading through them. The
 *     caller (state-surface-contrast-guard.spec.ts) waits out the
 *     transition so this case should not normally reach here; if it does,
 *     failing loudly is correct -- silently approximating an
 *     in-flight colour would be exactly the "guessing" task 2.7 forbids.
 * `transparent` and the empty string both mean fully transparent.
 *
 * @param {string} input
 * @returns {RGBA}
 */
export function parseColor(input) {
  const value = (input ?? "").trim();
  if (value === "" || value === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const rgbMatch = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i,
  );
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    return {
      r: Number(r),
      g: Number(g),
      b: Number(b),
      a: a === undefined ? 1 : Number(a),
    };
  }
  const colorSrgbMatch = value.match(
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/i,
  );
  if (colorSrgbMatch) {
    const [, r, g, b, a] = colorSrgbMatch;
    return {
      r: Number(r) * 255,
      g: Number(g) * 255,
      b: Number(b) * 255,
      a: a === undefined ? 1 : Number(a),
    };
  }
  throw new Error(`stateContrast.parseColor: unrecognized colour "${input}"`);
}

/**
 * Alpha-composites `top` over `bottom` per the standard "source-over"
 * formula, in sRGB space (matching how the browser paints CSS colours --
 * no gamma-correct blending anywhere in this app's rendering path). Both
 * inputs may themselves carry alpha < 1; the result's alpha reflects the
 * combined coverage, which is what makes ancestor-chain accumulation
 * (design.md D4.2) correct for a chain of translucent layers, not only a
 * single translucent layer over an opaque floor.
 *
 * @param {RGBA} top
 * @param {RGBA} bottom
 * @returns {RGBA}
 */
export function compositeOver(top, bottom) {
  const outA = top.a + bottom.a * (1 - top.a);
  if (outA === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const mix = (channel) => (top[channel] * top.a + bottom[channel] * bottom.a * (1 - top.a)) / outA;
  return { r: mix("r"), g: mix("g"), b: mix("b"), a: outA };
}

/**
 * Composites an ordered list of backgrounds, nearest-first (the element's
 * own background first, root last), into a single opaque colour. Callers
 * (both the guard and its self-test) build this list by walking the
 * rendered ancestor chain and MUST NOT stop at the first background with
 * alpha > 0 -- design.md D4.2's "first non-transparent ancestor is
 * undefined for alpha in (0,1)" -- every layer with alpha > 0 is included,
 * in DOM order, until the accumulated alpha reaches (or the caller supplies
 * a final guaranteed-opaque) 1.
 *
 * @param {RGBA[]} layersNearestFirst
 * @returns {RGBA}
 */
export function compositeStack(layersNearestFirst) {
  // Fold from the FARTHEST layer toward the nearest: compositeOver(top,
  // bottom) treats its first argument as painted ON TOP of the second, so
  // reducing right-to-left (farthest first) and always passing the
  // accumulator as `bottom` paints each layer over everything behind it,
  // in the correct back-to-front order.
  let acc = { r: 0, g: 0, b: 0, a: 0 };
  for (let i = layersNearestFirst.length - 1; i >= 0; i--) {
    acc = compositeOver(layersNearestFirst[i], acc);
  }
  return acc;
}

function relativeLuminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG relative-luminance contrast ratio between two OPAQUE colours
 * (a must be 1 on both, enforced by the caller having already
 * alpha-composited -- design.md D4.3). Symmetric: order does not matter.
 *
 * @param {RGBA} a
 * @param {RGBA} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @typedef {"pass" | "fail" | "advisory" | "unresolved"} StateVerdict
 */

/**
 * Classifies a single element's before/during measurement per design.md
 * D4a / D1c (HEL-520). `backdrop` and `stateColor` must already be
 * alpha-composited to opaque colours (a === 1) by the caller -- this
 * function only computes the ratio and applies the split, it does not
 * composite.
 *
 * `stateKind` distinguishes WHICH state is being probed (design.md D1b):
 * for `"hover"` (the default, HEL-866's original behaviour, preserved
 * unchanged), an outline/border/box-shadow-only change is still deferred
 * as `"advisory"` -- adjudicating a shadow-only/border-only hover design is
 * HEL-1044's call, not this guard's. For `"focus"` (HEL-520), that
 * deferral is closed: a focus state conveyed only via outline/border/
 * box-shadow is RATIO-ENFORCING, not advisory (accessible-focus-indicator
 * spec, "A focus state conveyed only by outline, border, or shadow is
 * adjudicated rather than deferred"). In that branch, `stateColor` is the
 * indicator's own (already-composited) colour -- the ring/border/shadow
 * colour, not the element's background -- measured against the same
 * composited `backdrop` used elsewhere in this function.
 *
 * @param {{
 *   backgroundChanged: boolean,
 *   otherChannelChanged: boolean,
 *   backdrop: RGBA,
 *   stateColor: RGBA,
 *   threshold?: number,
 *   stateKind?: "hover" | "focus",
 * }} params
 * @returns {{ verdict: StateVerdict, ratio: number | null }}
 */
export function classifyState({
  backgroundChanged,
  otherChannelChanged,
  backdrop,
  stateColor,
  threshold = CONTRAST_THRESHOLD,
  stateKind = "hover",
}) {
  if (!backgroundChanged) {
    if (stateKind === "focus" && otherChannelChanged) {
      // D1c: close the deferral for focus specifically. `stateColor` here
      // is the outline/border/box-shadow indicator's own composited
      // colour, supplied by the caller -- the presence-then-ratio floor
      // is applied to it exactly as it would be to a background change.
      if (backdrop.a !== 1 || stateColor.a !== 1) {
        throw new Error(
          "stateContrast.classifyState: backdrop/stateColor must be alpha-composited to opaque before classification",
        );
      }
      const ratio = contrastRatio(backdrop, stateColor);
      return { verdict: ratio >= threshold ? "pass" : "fail", ratio };
    }
    // D4a: nothing changed at all -> fail (no feedback whatsoever).
    // border/outline/box-shadow changed on a HOVER probe -> advisory
    // (HEL-1044's call, not ours -- adjudicating a shadow-only/border-only
    // design is out of scope here).
    return { verdict: otherChannelChanged ? "advisory" : "fail", ratio: null };
  }
  if (backdrop.a !== 1 || stateColor.a !== 1) {
    // Caller passed an un-composited colour -- this is a programming error
    // in the caller, not a runtime "unresolved" case (unresolved is for
    // ancestor-walk failures like opacity/background-image, task 2.7/D4a),
    // so fail loudly rather than silently mis-scoring.
    throw new Error(
      "stateContrast.classifyState: backdrop/stateColor must be alpha-composited to opaque before classification",
    );
  }
  const ratio = contrastRatio(backdrop, stateColor);
  return { verdict: ratio >= threshold ? "pass" : "fail", ratio };
}
