import { expect, type Locator, type Page } from "@playwright/test";

// HEL-813 — shared rendered-geometry measurement helper for the mobile
// 44px touch-target floor, imported by BOTH the steady-state CI guard
// (e2e/hel813-mobile-touch-target-floor.spec.ts) and the one-shot
// demonstrated-RED regression harness
// (e2e/hel813-mobile-touch-target-floor.regression.spec.ts) — see
// design.md D2. The point of sharing this module is structural: "the same
// measurement logic goes red on the known-bad shape" is guaranteed by
// import, not just asserted in prose.
//
// Deliberately measures `getBoundingClientRect()` at runtime, never CSS
// source text — see ticket.md's "why the obvious implementation is a trap".

export const DEFAULT_MIN_PX = 44;

export interface BoxMeasurement {
  width: number;
  height: number;
  visible: boolean;
}

/** Visibility-gated `getBoundingClientRect()` read. A zero-area or
 *  non-`visible` (Playwright's own actionability visibility check, which
 *  also covers `display: none` / not-in-the-a11y-tree ancestors) element
 *  measures as `visible: false` regardless of its raw rect numbers, so a
 *  hidden 44x44 box can never masquerade as a real pass. */
export async function measureBox(locator: Locator): Promise<BoxMeasurement> {
  const visible = await locator.isVisible();
  if (!visible) {
    return { width: 0, height: 0, visible: false };
  }
  const box = await locator.boundingBox();
  if (box === null) {
    return { width: 0, height: 0, visible: false };
  }
  return { width: box.width, height: box.height, visible: true };
}

/** Asserts BOTH axes meet the floor, and asserts the element is actually
 *  visible/rendered — a hidden element never silently passes by measuring
 *  0x0 against a naive `>=` check, and a hidden element never silently
 *  passes by short-circuiting past the size assertions either. */
export async function assertFloor(
  locator: Locator,
  { minPx = DEFAULT_MIN_PX }: { minPx?: number } = {},
): Promise<void> {
  const { width, height, visible } = await measureBox(locator);
  expect(visible, "control must be rendered/visible to be measured").toBe(true);
  expect(height, "rendered height must meet the mobile tap-target floor").toBeGreaterThanOrEqual(
    minPx,
  );
  expect(width, "rendered width must meet the mobile tap-target floor").toBeGreaterThanOrEqual(
    minPx,
  );
}

/** Asserts a control is genuinely NOT rendered at the current viewport —
 *  distinct from, and never a substitute for, `sweepSurface`'s non-zero
 *  visible-floored-match requirement (design.md D2/D3 item 6, HEL-781's
 *  zoom controls hidden below 430px). */
export async function assertHiddenAtWidth(locator: Locator): Promise<void> {
  const visible = await locator.isVisible();
  expect(visible, "control must be genuinely hidden (not merely small) at this width").toBe(false);
}

export type BisectAxis = "x" | "y";

/** `elementFromPoint` bisection along one axis for `::after`-hit-expander
 *  controls (DESIGN.md Control-metrics / HEL-772/777). Neither
 *  `getComputedStyle(el, "::after")` nor box-based measurement can see an
 *  overlapping-expander truncation — only walking outward from the
 *  control's own center and asking the browser what element actually
 *  occupies each point can.
 *
 *  Asserts INSIDE the helper against `>= 44 - samplingStep` (never a
 *  literal `>= 44` — a correctly abutting hit region legitimately bisects
 *  to just under 44px, per DESIGN.md lines 215-223) so no call site can
 *  reintroduce the wrong threshold. */
export async function bisectHitExtent(
  page: Page,
  locator: Locator,
  axis: BisectAxis,
  samplingStep = 0.25,
  { minPx = DEFAULT_MIN_PX }: { minPx?: number } = {},
): Promise<number> {
  const handle = await locator.elementHandle();
  if (handle === null) {
    throw new Error("bisectHitExtent: could not resolve an element handle");
  }

  // Settle before measuring. `boundingBox()` does NOT wait for actionability
  // or stability, and under the Vite dev server (which both CI and local runs
  // use) stylesheets are injected by JS after first paint — so a probe issued
  // straight after `goto` can read the control's UNSTYLED coordinates, then
  // walk points the control has since moved away from. The walk finds nothing
  // at the very first step and the extent comes back as a flat `0`, which
  // reads like a real overlap bug rather than a stale rect.
  //
  // Poll until the control's own centre actually hits it, re-reading the rect
  // each time so the coordinates the walk uses are the ones that just passed.
  // This is a genuinely different assertion from the walk below: this one says
  // "the rect is current", the walk says "the hit region is big enough".
  let box = await locator.boundingBox();
  await expect
    .poll(
      async () => {
        box = await locator.boundingBox();
        if (box === null) return false;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        return await page.evaluate(
          ({ cx, cy, elHandle }) => {
            const at = document.elementFromPoint(cx, cy);
            return at !== null && (elHandle === at || elHandle.contains(at));
          },
          { cx, cy, elHandle: handle },
        );
      },
      {
        message:
          "control's own centre must hit the control before its extent is measured — a stale " +
          "rect (measured before dev-server CSS applied) would otherwise bisect to a bogus 0",
        timeout: 5_000,
      },
    )
    .toBe(true);

  if (box === null) {
    throw new Error("bisectHitExtent: control has no bounding box (not rendered)");
  }
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // Walk outward from center in BOTH directions along the axis, in
  // `samplingStep` increments, until `document.elementFromPoint` no longer
  // resolves to the control (or one of its descendants) — the real,
  // region-vs-region hit extent, not the painted box and not the ::after's
  // own declared width/height.
  const extentPx = await page.evaluate(
    ({ centerX, centerY, axis, samplingStep, elHandle }) => {
      function containsPoint(x: number, y: number): boolean {
        const atPoint = document.elementFromPoint(x, y);
        return atPoint !== null && (elHandle === atPoint || elHandle.contains(atPoint));
      }

      function walk(direction: 1 | -1): number {
        let distance = 0;
        while (true) {
          const nextDistance = distance + samplingStep;
          const x = axis === "x" ? centerX + direction * nextDistance : centerX;
          const y = axis === "y" ? centerY + direction * nextDistance : centerY;
          if (!containsPoint(x, y)) break;
          distance = nextDistance;
        }
        return distance;
      }

      const positiveExtent = walk(1);
      const negativeExtent = walk(-1);
      return positiveExtent + negativeExtent;
    },
    { centerX, centerY, axis, samplingStep, elHandle: handle },
  );

  expect(
    extentPx,
    `bisected ${axis}-axis hit extent must clear the epsilon-adjusted floor (>= ${minPx - samplingStep})`,
  ).toBeGreaterThanOrEqual(minPx - samplingStep);

  return extentPx;
}

export interface ExemptEntry {
  selector: string;
  reason: string;
  ticket?: string;
}

export interface SweepSurfaceOptions {
  selectors: string[];
  exempt?: ExemptEntry[];
  minPx?: number;
  /** Optional scope, e.g. a dialog's own locator, to disambiguate from an
   *  identically-classed desktop-only twin mounted (but `display:none`) in
   *  the same DOM — see e2e/hel773-*.spec.ts's root-cause note on
   *  `.ui-empty-state__cta`. Defaults to the whole page. */
  scope?: Locator;
}

/** Sweeps every visible match of `selectors` on a surface, asserting the
 *  floor on each EXCEPT elements also matched by an `exempt` entry
 *  (design.md D2 / skeptic CR1 exemption contract). Every exempt entry is
 *  logged (reason + optional ticket id) so an allowlist skip is auditable
 *  from CI output alone. Exempt matches are confirmed to exist (still
 *  rendered) but do not count toward, and cannot alone satisfy, the
 *  non-zero visible-floored-match requirement — a surface consisting only
 *  of exempt matches still fails. */
export async function sweepSurface(
  page: Page,
  { selectors, exempt = [], minPx = DEFAULT_MIN_PX, scope }: SweepSurfaceOptions,
): Promise<void> {
  const root = scope ?? page.locator("body");

  const exemptSelectorSet = new Set(exempt.map((e) => e.selector));
  for (const entry of exempt) {
    // Auditable from CI output alone (skeptic CR1).
    console.log(
      `[hel813] exempt: ${entry.selector} — ${entry.reason}${entry.ticket ? ` (${entry.ticket})` : ""}`,
    );
    const exemptLocator = root.locator(entry.selector);
    const exemptCount = await exemptLocator.count();
    expect(
      exemptCount,
      `exempt selector "${entry.selector}" must still exist/render`,
    ).toBeGreaterThan(0);
  }

  let visibleFlooredMatches = 0;

  for (const selector of selectors) {
    if (exemptSelectorSet.has(selector)) {
      // A selector that IS the exempt entry itself never contributes to
      // the floor sweep or the non-zero count — handled entirely above.
      continue;
    }
    const locator = root.locator(selector);
    const count = await locator.count();
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i);
      const visible = await el.isVisible();
      if (!visible) continue;
      // Skip elements that are also matched by an exempt selector — an
      // element can be exempt without its exempt selector being literally
      // passed in `selectors` too (e.g. exempt covers a more specific
      // selector nested under a broader swept one).
      let isExempt = false;
      for (const entry of exempt) {
        const matches = await el.evaluate((node, sel) => node.matches(sel), entry.selector);
        if (matches) {
          isExempt = true;
          break;
        }
      }
      if (isExempt) continue;

      await assertFloor(el, { minPx });
      visibleFlooredMatches += 1;
    }
  }

  expect(
    visibleFlooredMatches,
    "sweepSurface must match at least one visible, non-exempt, floored candidate — a surface " +
      "with zero visible matches (or only exempt/hidden matches) must fail, not pass vacuously",
  ).toBeGreaterThan(0);
}
