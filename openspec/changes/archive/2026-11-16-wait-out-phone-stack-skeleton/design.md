## Context

Root cause, established from the CI trace (not from the ticket's hypothesis). Artifact `playwright-report-shard-5`
of run 43925410610 (fd7064f7d) contains `trace.zip` for the failing dark test; a copy is under
`.concertino/scratch/HEL-1724/ci-artifact/` in the main checkout.

- The geometry `page.evaluate` (call@11041) returned `cardLeft`/`cardRightGap` arrays of length **6** and
  `gaps = [10, 10, -379.76, 10.23, 10.40]` for a dashboard seeded with **3** markdown panels.
- The DOM snapshot taken right after the spec's readiness wait (call@11033, first
  `.mobile-panel-stack__item--markdown .markdown-panel` visible) holds
  `.crossfade__layer.crossfade__skeleton.crossfade__skeleton--leaving` (aria-hidden, inert) with
  `aria-label="Loading panels"` around a `MobilePanelStackSkeleton` whose stubs are
  `.panel-grid-card.mobile-panel-stack__item.mobile-panel-stack__item--metric` (`--mobile-panel-height: 120px`),
  next to the real stack: 6 `.mobile-panel-stack__item` in all, skeleton first in DOM order.
- `Crossfade.css`: both layers sit in one grid cell (`grid-area: 1 / 1`), so the real stack starts at the same top
  as the skeleton stack. Gaps 0-1 are stub-to-stub (exactly 10), gap 2 is stub 3 bottom to real card 1 top
  (-379.76), gaps 3-4 are real-to-real.
- Why the light variant passed: timing only. The skeleton fade lasts `--motion-duration-standard`; whether the
  geometry read lands inside it depends on how long fonts/markdown take after the real stack mounts. Theme is not a
  factor.
- `waitForPanelGrid` (HEL-1633) cannot be reused as is: at phone widths the real stack renders no
  `.react-grid-item`, so its step 1 would time out (its own doc comment says so).

Secondary observation, to be probed (not assumed): real-to-real gaps of 10.23/10.40 instead of the CSS 10 suggest
the real cards' HEL-1584 entrance animation (`useKeyedEntrance`, transform-based) is still running at the read. That
is inside the 8-12 tolerance, but `toBeCloseTo(12, 0)` on card left/right could be hit by a scale transform.

## Goals / Non-Goals

**Goals:** a non-vacuous phone-stack readiness wait; hel1583 measures only real, settled cards; the same race is
closed in sibling specs that read `.mobile-panel-stack__item` right after a load; AC2 evidence (red under forced
repro, then 40/40).

**Non-Goals:** product code changes; `e2e/hel1575-dashboard-tabs.spec.ts` (HEL-1644); retries or larger timeouts.

## Decisions

**D1. Extend `e2e/support/panelGridReady.ts`, do not duplicate it.** Add, additively:
- `export const LIVE_STACK_ITEMS = ".crossfade__layer:not(.crossfade__skeleton) .mobile-panel-stack__item";`
- `export async function waitForPanelStack(page, count, { timeout = 15_000 } = {})`: (1) expect
  `page.locator(LIVE_STACK_ITEMS)` toHaveCount(count); (2) expect `page.getByLabel("Loading panels")` toHaveCount(0).
  Same ordering rationale as `waitForPanelGrid` (step 2 alone passes vacuously before React mounts). Doc comment
  states phone widths only (below the stack breakpoint), mirroring the existing one.
- Update `waitForPanelGrid`'s doc comment only to point at the phone sibling. Its body is unchanged. Keep the diff in
  this shared file minimal and call it out in the PR (another lane may touch e2e support).
Alternative rejected: a single helper that branches on viewport width - hides which DOM is expected and makes a
wrong-width call pass/fail confusingly.

**D2. hel1583 `open()` uses it.** After `goto`, call `waitForPanelStack(page, 3)` (the first dashboard is seeded
with 3 panels), then keep the existing lazy-markdown visibility wait and `document.fonts.ready`. The geometry read in
the :156 test switches its `querySelectorAll` to the live-layer selector as belt and braces (the skeleton is already
unmounted after D1, but a measurement should name the layer it means). Tests in the file that `open()` a dashboard
other than the 3-panel first one, or switch dashboards and then measure, must be checked: any measurement after a
dashboard switch needs its own wait with the right count. `open()` must stay valid for every caller in the file.

**D3. Entrance animation: probe, then decide.** Executor records, at the geometry read after D1/D2, whether any
`CSSAnimation`/`CSSTransition` is running on a real `.mobile-panel-stack__item` (`el.getAnimations()`), and the
rects with and without waiting those out. If entrance motion is still running and moves the measured edges, also wait
for those animations to finish (an existing helper such as `settleTransitions` only covers `CSSTransition`; if the
entrance is a `CSSAnimation`, await `el.getAnimations()` finished on the measured items, finite animations only,
bounded). If the probe shows no running animation or no effect on the asserted values, do nothing and record the
probe result. Either outcome is written to evidence with numbers.

**D4. Forced repro and guard (AC2).** Forced repro mirrors HEL-1633's guard technique: an init script that stretches
ONLY `.crossfade .crossfade__skeleton` `transition-duration` to 3000ms (`!important`), plus `page.route` holding
`**/api/dashboards/*/panels` back ~1.5 s so the skeleton is on screen. Two uses:
1. Red-first: run the UNMODIFIED hel1583 :156 test (pre-fix tree, both themes) with the stretch applied via a
   throwaway probe (not committed) and record it failing with the 6-card geometry; then the same probe against the
   fixed spec, green.
2. Committed guard `e2e/hel1724-panel-stack-ready.spec.ts` at 375px: start `waitForPanelStack` straight after
   `goto(..., { waitUntil: "commit" })`, prove in parallel that skeleton stubs are attached and the fade is
   stretched to 3s, then one-shot (non-retrying) reads: total `.mobile-panel-stack__item` count == panel count,
   `getByLabel("Loading panels")` count 0, every item has non-zero size, consecutive gaps >= 0. Failability recorded
   by mutation: helper without step 2 -> red; helper without step 1 -> red. Each mutation run reverted.
No retries (`retries` stays as configured; no `test.describe.configure({ retries })`), no timeout increases.

**D5. Sweep.** Grep `grep -rn "mobile-panel-stack__item" e2e` (14 files on 86763e881). Each hit gets one verdict,
with a line reference: FIX (a count/measure/`.first()`/`.nth()` of a bare `.mobile-panel-stack__item` or
`.panel-grid-card` reached right after a navigation/reload/dashboard switch at phone width, with no prior wait in that
test that excludes the skeleton); OK-filtered (filtered by real content - title, text, a type modifier the stubs do
not carry; stubs carry `--metric` only, so `--metric` is NOT a safe filter); OK-settled / OK-already-waits (cite the
wait); OK-not-a-load (cite why). `hel1646-skeleton-refresh-slot.spec.ts` deliberately measures the skeleton - verdict
with justification, not a fix. `e2e/hel1575-dashboard-tabs.spec.ts` is excluded by constraint even if hit. FIX only
where the race is real; record everything in `sweep.md` in the change directory. If the sweep finds more than ~5 FIX
sites, stop and report rather than widening.

**D6. Repeat proof.** `nice -n 19 npx playwright test e2e/hel1583-mobile-dashboard.spec.ts:156
--repeat-each 20 --workers 2 --trace retain-on-failure` runs both themes, so 40 executions; 40/40 required. Also run
the whole hel1583 file and the new guard once, and every FIX-touched spec once.

## Risks

- `waitForPanelStack(page, 3)` hard-codes the seeded count in `open()`; a future change to seeding must update it
  (an assertion failure, not a silent pass).
- Shared support file touched by another lane: additive change only, called out in the PR.
