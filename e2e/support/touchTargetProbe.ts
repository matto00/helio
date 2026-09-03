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

/** HEL-935/HEL-818 — narrow, documented tolerance for plain rendered-box
 *  (`getBoundingClientRect()`) floor checks in `assertFloor`/`sweepSurface`.
 *
 *  Root cause (confirmed, not assumed, re-verified by HEL-818): both
 *  `.ui-select__trigger` and `.ui-select__option` declare a literal
 *  `min-height: 44px`, `box-sizing: border-box` (global reset in
 *  `theme.css`), a 1px border (trigger only) and zero padding — no
 *  `calc()`, no fractional line-height overflow (`line-height: 19.6px`
 *  sits far inside the ~42px content box). `getComputedStyle` reports
 *  `height: 44px` / `min-height: 44px` on the element itself, every time.
 *  HEL-818 dumped the full ancestor chain (`.ui-select` → `.ui-select__
 *  trigger`'s parents up through the modal's `.ui-modal__inner`) and found
 *  the SAME pattern on every ancestor: each one's own `getComputedStyle`
 *  reports a round integer pixel height while its `getBoundingClientRect`
 *  measures a stable fraction below that integer (e.g. a `height: 90px`
 *  ancestor rendering at `89.31px`). This is Chromium distributing
 *  fractional pixels across a chain of nested flex containers (the modal's
 *  `.ui-modal__inner` → `.ui-modal__body` → `.create-pipeline-modal__form`
 *  → `.create-pipeline-modal__field` → `.ui-select` → `.ui-select__
 *  trigger`) — an ambient rasterization/subpixel-layout behavior of the
 *  surrounding layout context, not a border/padding/line-height/calc
 *  defect in either selector's own declared CSS. Nothing here is a probe
 *  race: it is the same class of sub-pixel layout rounding HEL-897
 *  explicitly is NOT (HEL-897 is a flat, deterministic `extent 0` from a
 *  Node<->browser round-trip race in `bisectHitExtent`, a completely
 *  different code path this function does not use).
 *
 *  Magnitude (re-measured, not assumed): HEL-935's original 60-repeat
 *  sample of `.ui-select__option` was mostly-exact (59/60 measured exactly
 *  `44`, one outlier at `43.87115478515625`, a 0.13px gap) — that shape
 *  justified the original `0.5` value. HEL-818 sampled `.ui-select__
 *  trigger` far more aggressively (120 samples: 60 repeats each at 430px
 *  and 768px, opening/closing the Create Pipeline modal's data-source
 *  Select) and found a DIFFERENT shape for the trigger: it never measured
 *  exactly `44` in any of the 120 samples, and its single most common value
 *  (`43.3399658203125`, ~0.66px short) was not a rare outlier but the
 *  MODE of the distribution — around 90% of samples landed below the old
 *  `0.5`-epsilon floor of `43.5`. Both selectors are legitimately governed
 *  by the same ambient-rasterization mechanism (see the ancestor-chain
 *  evidence above), but the trigger's deeper, more heavily-nested flex
 *  ancestor chain (it sits inside a modal form; the option list sits in a
 *  simpler popover) compounds more fractional loss, so one shared value has
 *  to cover the worse of the two measured distributions, not the better.
 *
 *  `0.75` is chosen with a real margin above the worst 120-sample
 *  measurement (`43.3399658203125`, a 0.6600341796875px gap) rather than
 *  set exactly at it, while staying many multiples smaller than every known
 *  real violation this guard exists to catch (HEL-781's 28px control is
 *  16px short of the floor — over 21x this tolerance; HEL-535's inert-floor
 *  cases measure 0 and are already caught by the `visible` assertion above,
 *  never by this epsilon). See `e2e/hel813-mobile-touch-target-floor.
 *  regression.spec.ts` (`HEL813_REGRESSION=1`) for the mechanical proof
 *  that both mutation shapes still go red at this tolerance. */
export const RENDERED_BOX_EPSILON_PX = 0.75;

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
  const selector = describeLocatorForFailureMessage(locator);
  const floor = minPx - RENDERED_BOX_EPSILON_PX;
  expect(visible, `control must be rendered/visible to be measured (${selector})`).toBe(true);
  expect(
    height,
    `expected >= ${minPx}px (epsilon ${RENDERED_BOX_EPSILON_PX}, floor ${floor}px), ` +
      `measured height ${height}px on ${selector} — rendered height must meet the mobile ` +
      `tap-target floor (see RENDERED_BOX_EPSILON_PX — HEL-935/HEL-818 sub-pixel rendering allowance)`,
  ).toBeGreaterThanOrEqual(floor);
  expect(
    width,
    `expected >= ${minPx}px (epsilon ${RENDERED_BOX_EPSILON_PX}, floor ${floor}px), ` +
      `measured width ${width}px on ${selector} — rendered width must meet the mobile ` +
      `tap-target floor (see RENDERED_BOX_EPSILON_PX — HEL-935/HEL-818 sub-pixel rendering allowance)`,
  ).toBeGreaterThanOrEqual(floor);
}

/** Best-effort, synchronous description of a locator for failure messages —
 *  Playwright locators stringify their own selector chain via `toString()`
 *  (e.g. `locator('.ui-select__option')`), which is exactly what a reader
 *  needs to identify which surface/selector failed without re-running
 *  anything. Never throws: falls back to a fixed placeholder if a future
 *  Playwright version changes that shape. */
function describeLocatorForFailureMessage(locator: Locator): string {
  try {
    return locator.toString();
  } catch {
    return "<unknown locator>";
  }
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

/** Thrown when a control never reaches stable, hit-testable geometry within
 *  the readiness budget — i.e. "not ready", as opposed to `expect()` failing
 *  the floor assertion once geometry IS stable, which means "too small".
 *  HEL-897: these two outcomes were previously indistinguishable — both
 *  surfaced as a bisected extent of `0`. Callers (and CI logs) can now tell
 *  a genuine touch-target regression apart from a harness timing failure by
 *  which error they see. */
export class HitRegionNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HitRegionNotReadyError";
  }
}

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
 *  reintroduce the wrong threshold.
 *
 *  Root cause (HEL-897): the previous implementation split "wait until the
 *  control's centre hits it" and "walk outward to find the hit extent" into
 *  TWO separate Node↔browser round trips (`locator.boundingBox()` then a
 *  later `page.evaluate(...)`), reading the element's geometry once via one
 *  IPC call and consuming it via a second, later one. Under CI's slower,
 *  colder Vite dev-server (fresh checkout, no warm module/style cache,
 *  shared-runner contention), the gap between those two round trips is long
 *  enough for the page to keep changing underneath the probe — a pending
 *  style recalc lands, or the underlying DOM node is replaced by a React
 *  re-render — after the centre-hit poll already passed but before the walk
 *  runs. The walk then reads a stale `elementHandle`/coordinates pair and
 *  finds nothing at the very first sampled point in EITHER direction,
 *  which is exactly the flat, deterministic `Received: 0` this ticket
 *  documents (not a plausible sub-floor number, which a genuine sizing
 *  regression would produce).
 *
 *  The fix removes the gap rather than papering over it: readiness
 *  (geometry connected, unchanged across two consecutive animation frames,
 *  AND hit-testable at its own centre) and the bisection walk now run
 *  inside the SAME `page.evaluate` call, so there is no Node round trip
 *  between "confirm it's ready" and "measure it" for anything to invalidate
 *  in between. This is a readiness assertion, not a longer sleep: it
 *  explicitly requires two-consecutive-frame geometric stability (which
 *  fails fast on an active CSS transition/animation or an as-yet-unapplied
 *  stylesheet) rather than waiting a fixed duration and hoping. */
export async function bisectHitExtent(
  page: Page,
  locator: Locator,
  axis: BisectAxis,
  samplingStep = 0.25,
  {
    minPx = DEFAULT_MIN_PX,
    readyTimeoutMs = 5_000,
  }: { minPx?: number; readyTimeoutMs?: number } = {},
): Promise<number> {
  const handle = await locator.elementHandle();
  if (handle === null) {
    throw new Error("bisectHitExtent: could not resolve an element handle");
  }

  const result = await page.evaluate(
    ({ axis, samplingStep, elHandle, readyTimeoutMs }) => {
      function rectsEqual(a: DOMRect, b: DOMRect): boolean {
        return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      }

      function centerHits(rect: DOMRect): boolean {
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const at = document.elementFromPoint(cx, cy);
        return at !== null && (elHandle === at || elHandle.contains(at));
      }

      /** Resolves with the settled rect once geometry has been IDENTICAL
       *  across two consecutive animation frames and is currently
       *  hit-testable at its own centre — never a fixed sleep, always a
       *  frame-referenced stability check, so a control that's still
       *  transitioning/animating (or awaiting an as-yet-unapplied
       *  stylesheet) keeps failing this gate rather than being measured
       *  mid-motion. Resolves `null` on timeout (not-ready) rather than a
       *  detected-but-too-small control (a `DOMRect` with `width`/`height`
       *  can still legitimately be below the floor -- that is NOT a
       *  not-ready case and must reach the bisection walk below). */
      function waitForSettledRect(): Promise<DOMRect | null> {
        return new Promise((resolve) => {
          const deadline = performance.now() + readyTimeoutMs;
          function attempt() {
            if (!elHandle.isConnected) {
              if (performance.now() > deadline) return resolve(null);
              requestAnimationFrame(attempt);
              return;
            }
            const r1 = elHandle.getBoundingClientRect();
            requestAnimationFrame(() => {
              if (!elHandle.isConnected) {
                if (performance.now() > deadline) return resolve(null);
                requestAnimationFrame(attempt);
                return;
              }
              const r2 = elHandle.getBoundingClientRect();
              if (rectsEqual(r1, r2) && centerHits(r2)) {
                resolve(r2);
                return;
              }
              if (performance.now() > deadline) {
                resolve(null);
                return;
              }
              requestAnimationFrame(attempt);
            });
          }
          requestAnimationFrame(attempt);
        });
      }

      function containsPoint(x: number, y: number): boolean {
        const atPoint = document.elementFromPoint(x, y);
        return atPoint !== null && (elHandle === atPoint || elHandle.contains(atPoint));
      }

      function walk(centerX: number, centerY: number, direction: 1 | -1): number {
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

      return waitForSettledRect().then((rect) => {
        if (rect === null) {
          return { ready: false as const };
        }
        // Bisect IMMEDIATELY off the just-settled rect, in the same task —
        // no further await, no round trip back to Node, so nothing else can
        // invalidate these coordinates between confirming readiness and
        // measuring the extent (the root-cause gap this fix closes).
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const extentPx = walk(centerX, centerY, 1) + walk(centerX, centerY, -1);
        return { ready: true as const, extentPx, rect: { width: rect.width, height: rect.height } };
      });
    },
    { axis, samplingStep, elHandle: handle, readyTimeoutMs },
  );

  if (!result.ready) {
    throw new HitRegionNotReadyError(
      `bisectHitExtent: control never reached stable, hit-testable geometry within ${readyTimeoutMs}ms ` +
        "(still animating, mid CSS-injection, or its DOM node was replaced) — this is a readiness " +
        "failure, NOT a touch-target-floor violation.",
    );
  }

  expect(
    result.extentPx,
    `bisected ${axis}-axis hit extent must clear the epsilon-adjusted floor (>= ${minPx - samplingStep})`,
  ).toBeGreaterThanOrEqual(minPx - samplingStep);

  return result.extentPx;
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
