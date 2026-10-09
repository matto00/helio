## Context

The spec loads a dashboard once per theme and then resizes the viewport live with `setViewportSize` through windows 1900 (lg) → 1500 (md) → 1200 (sm) → 1056 (sm) → 400 (stack), reading `.react-grid-item` rects. `settledRects` (spec ~line 243) waits for: the item count, then `.panel-grid`'s box width to equal the expected width, then two consecutive reads 150 ms apart agreeing within 0.5 px.

**What the container poll actually observes.** `.panel-grid` is RGL's `<Responsive className="panel-grid">` root (`frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx:349`); its box width is set by CSS and follows the viewport on the next reflow. RGL's own `width` prop — which is what positions/sizes items and selects the breakpoint — is a separate value: `useContainerWidth` in `PanelList.tsx:76` observes `.panel-list__zoom-container`, and per `frontend/node_modules/react-grid-layout/dist/chunk-BMN6M2VL.js:44-54` (v2.2.4) the path is ResizeObserver callback → `requestAnimationFrame` → `setWidth` → React re-render → item re-layout. So the poll can pass before RGL has received the new width, and two `page.evaluate` reads (which need no frame) 150 ms apart can agree on stale geometry whenever rAF / frame production is delayed (e.g. a loaded headless CI runner). That CSS-first, RGL-second ordering is RGL's normal design, not a bug.

**What the failure shows.** At window 1500 the container box read 1212 while P8's right edge read 1876 = 264 + 1612, the lg container's right edge (verified from `results.json`: failed at 9795 ms, expected ≤ 1478, received 1876). P8 is not known to be special: the DOM order (error-context.md) is P8, P7, …, P1, the assertion loop stops at the first failure, and P2/P4/P6 also sit on the lg right edge in this fixture. So the observation is "at least the first-checked item was at lg geometry", not "the divider alone was stale". The fast failure (9.8 s on main; driver claims ~11.5 s vs ~26 s on PR #860 attempts) fits the first md read after the 1900→1500 resize, in the light-theme pass.

**Candidate causes (all unconfirmed):** (a) rAF / frame-production starvation between the RO callback and RGL's re-layout — the test measures before RGL has the new width; (b) ResizeObserver delivery timing; (c) RGL item CSS transition (`transform`/`width`) in progress or paused; (d) font-load reflow; (e) a product stale-render — RGL already rendering with md width/cols while some item keeps lg geometry (e.g. a memoised child, a key/remount path); (f) HEL-1392-class remount/refetch during resize.

Failed-run artifacts (results.json, error-context.md, trace.zip, and the extracted trace in `trace-x/`): `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1413-artifacts/home/runner/work/helio/helio/test-results` and `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1413-artifacts/home/runner/work/helio/helio/test-results/trace-x`.

## Goals / Non-Goals

**Goals:**
- A measured local failure rate (N, k) under capped contention.
- A probe-confirmed root cause that explains the observation, with every item's staleness recorded (not just P8's).
- A fix at that root cause and red→green evidence at a sample size derived conservatively from the measured rate.

**Non-Goals:**
- Loosening the ±2 px geometry tolerance, adding test retries, or blind/tuned `waitForTimeout` or settle windows (C1). Any such need is escalated to the owner as a coverage call.
- Editing `.github/workflows/ci.yml` or shard weights (C4).
- Fixing HEL-1392 (resize remount/refetch) itself. If it turns out to be the cause, escalate scope before folding it in.

## Decisions

1. **Investigation-first, branch on evidence.** (i) Read the CI trace: DOM snapshots before/after the 1900→1500 resize — every item's inline style (transform/width), the grid root's box width, and whether any item had moved to md geometry. (ii) Local repro: run the single test (`--grep C_lg_coords_everywhere --repeat-each=N`, 2 workers like CI, ≤ 4 max, `nice -n 19`, optionally capped CPU stress) to measure a rate. (iii) A temporary probe (an init script / `page.evaluate` instrumentation; removed before commit) that records, with `performance.now()` timestamps, across the resize: the ResizeObserver callback on `.panel-list__zoom-container`, the rAF callback that follows it, the `width`/breakpoint/cols RGL actually rendered with (observable e.g. via the React props on the grid root through a temporary dev hook, or by inferring cols from item pixel widths of all 8 items), the rect series of **every** item, `document.visibilityState`, whether rAF fires at all during the stale window, and running CSS transitions (`document.getAnimations()`).
   - *Rejected:* tuning waits first and measuring later. That breaks the systematic-debugging Iron Law.

2. **Product-vs-test decision rule turns on whether RGL received the new width, not on elapsed time.**
   - **Product bug** (C3 applies, fix the product) ONLY if the probe shows RGL rendered with width ≈ 1212 (md breakpoint/cols active) and one or more items still sit at lg geometry after that render committed and any transitions finished. Name a divider-specific cause only if the other items are at md geometry while P8 stays at lg.
   - **Measurement race (test-side)** if RGL's width/breakpoint had not yet updated when the test read the rects. This holds even when the stall persists until an unrelated event (a screenshot, an input, the next frame): that is frame starvation, not a product defect.
   - **Test-side fix options.** The fix must be causally tied to RGL having processed the resize: either (a) a frame-based wait that reuses or extends `e2e/support/settleTransitions.ts` (HEL-1288 — awaits real rAF ticks plus `getAnimations()` CSS transitions), e.g. awaiting rAF ticks so the RO→rAF→setWidth→commit chain has run before the stability comparison, and the stability check then also requiring transitions to be finished; or (b) a product-side observability hook (e.g. a breakpoint/width data attribute on the grid root set from RGL's `onBreakpointChange`/`onWidthChange`) that the test waits on. Option (b) is product code: if chosen, it is scoped explicitly in proposal Impact and covered by a unit test. A "stable for a window derived from the measured lag" approach is a tuned settle window and is NOT allowed (C1). The choice between (a) and (b) is made from the probe: (a) is only valid if the probe shows that a frame wait is sufficient, i.e. once rAF has run, RGL's width is current.

3. **Sample size, conservatively.** Measure k failures in N₀ runs and state both. Size the post-fix run count N from a conservative p — the lower end of a 95% interval on k/N₀ (Wilson), not the point estimate — so that (1−p_low)^N ≤ 0.05. State k, N₀, p_low, N, and the result. If the rate is too low to measure locally within a reasonable budget even under stress, report the stress level tried honestly and escalate rather than claim green.

4. **Spec delta only for a product fix.** The change carries `skip_specs: true` while the cause is unknown. If the root cause is a product bug, the executor removes `skip_specs` and adds a MODIFIED delta to `breakpoint-layout-resolution` with a "live resize across breakpoints" scenario. A pure observability attribute (Decision 2 option b) is not a requirement change and does not need a delta.

## Risks / Trade-offs

- The flake may not reproduce locally (CI runner timing differs; MISTAKES.md: local gates are blind to timing-only defects). Mitigation: capped CPU stress, 2 workers like CI, and the CI trace as primary evidence. If it still does not reproduce, escalate with the trace-based analysis rather than ship a speculative fix.
- A product fix to the grid could change layout timing for every panel kind. The existing e2e layout suites (hel1023, hel908, hel1230, drag/resize specs) must stay green.
- A shared helper change (`settleTransitions.ts`) affects its other callers; keep any extension additive (new function or opt-in parameter) so existing callers are unchanged.
- Shared dev DB / shared Playwright browser: each test registers its own throwaway user; residue (dashboard ids) must be recorded by exact id.
