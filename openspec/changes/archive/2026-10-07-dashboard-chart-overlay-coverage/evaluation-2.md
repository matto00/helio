## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: d8ea073b5bfbfcbf7c7ca6d1460d1cc4a5a38e41. Delta reviewed: fc69f7de9..d8ea073b5 (`e2e/hel1351-aggregated-chart-overlay.spec.ts`, `PanelCard.tsx`). Base a606a9833 was re-resolved live.

### Phase 1: Spec Review — PASS
- Cycle-1 CR1 is addressed in substance. The item-3 case now runs at 390x844 in the mobile stack and asserts canvas height < 179, `legend.show === true` and `legend.type === "scroll"`. These values are read from the live ECharts option. A red control (the same aggregation with no `compare`) asserts the legend stays hidden, and the header comment was corrected. The regenerated screenshots (gitignored `*.png`) show a genuinely compact card with "sum(amount) / vs 7d", plus a compact no-overlay card with no legend.
- Cycle-1 suggestion: `PanelCard.tsx:468-472` now sets `chartInspectConfig.aggregation` to null while `paginationRows` is null, matching the raw-row fallback.
- C1/C2 are unaffected by the delta.

### Phase 2: Code Review — FAIL
Gates, run fresh by me on d8ea073b5 (logs in `.eval-hel1351/c2/`; jest ran with 3 workers and every gate under `nice -n 19`):
- `npm run lint` 0, `npm run format:check` 0, frontend `tsc --noEmit` 0, `npm --prefix frontend run build` 0.
- Root jest: 376/376. Frontend jest: 460 suites, 4840/4840 passed.

**Mutation-proof claim, verified independently.** I set up a throwaway detached worktree at d8ea073b5 with its own pinned Vite on 6793. It proxied to the lane backend 9690, with the Origin header rewritten to the allowed 6783 in that throwaway's `vite.config.ts` only. The throwaway has since been removed.
- Mutation A, compact-legend rule reverted (`(effectiveCompact && !overlayApplied) ||` changed to `effectiveCompact ||`): the run is RED at spec line 281, `expect(withOverlay!.legendShow).toBe(true)` received `false`. This happened in both themes, in 2 of 2 runs.
- Mutation B, compact legend applied unconditionally (both `overlayApplied` guards removed): the run is RED at line 287, `expect(withoutOverlay!.legendShow).toBe(false)` received `true`. Both themes failed this way in run 2. Run 1 failed earlier on the flake below, so it did not reach that assertion.
- So the claim holds: the spec fails if D6 is reverted or made unconditional.

**Issue: the item-3 block is flaky on unmodified code.** The same spec at d8ea073b5 with no mutation failed 3 of 8 test executions across 4 runs (`e2e-green*.log`). Each failure was `TypeError: Cannot read properties of null (reading 'height')` at line 280. The cause is that `liveChart(stackCompact)` returns `null` immediately after the `expect.poll` on the same locator passed.
- The structure is "poll until series contains 'vs 7d', then read again and assert on the second read". The second read is unguarded and can land on a canvas whose ECharts component is not (or is no longer) reachable.
- Hypothesis, not probe-confirmed: right after the 390px resize, the desktop grid's `<article>` (PanelCard also renders `<article>`) satisfies the poll and is then unmounted. The mobile stack's lazily loaded chart has not mounted its ReactECharts instance at the moment of the re-read.
- The defect itself (a re-read after a passing poll, failing about 37% of the time here) is observed, whatever the exact cause. The repo has just spent several tickets on e2e fragility under CPU contention (HEL-1298, HEL-1341, HEL-1353), so this would flake in CI.

### Phase 3: UI Review — PASS
The UI behaviour was verified live in cycle 1 (items 1, 3 and 4, both themes, 1440/1100/768/390). The delta changes no rendering. The mutation runs above re-exercised item 3 live, in both themes, against real history.

### Overall: FAIL

### Change Requests
1. `e2e/hel1351-aggregated-chart-overlay.spec.ts:271-287`: remove the read-after-poll race.
   - Poll on the full snapshot and assert on the value the poll captured. For example: `let withOverlay; await expect.poll(async () => { withOverlay = await liveChart(stackCompact); return withOverlay !== null && withOverlay.height < 179 && withOverlay.series.includes("vs 7d"); }, { timeout: 15_000 }).toBe(true);` then assert `legendShow`/`legendType` on `withOverlay`. Do the same for `stackPlain`, where a single unpolled read can also be null.
   - Also scope the locators to the mobile stack, or first wait for `.react-grid-item` to have count 0 after `setViewportSize`, so a desktop-grid `<article>` can never satisfy them.
   - Keep the red control and the two assertions that mutations A and B turn red (lines 281 and 287). After the change, run the spec at least 5 times unmodified and report the pass count.

### Non-blocking Suggestions
- `PanelCard.tsx:468-472` (the `aggregation` null-without-rows change) has no unit test. A one-line case in `PanelCard.aggregateChart.test.tsx` would pin it.
- `liveChart` duplicates the fiber walk; fine for one spec, but extract it to `e2e/support/` if a second spec needs it.

### Evidence (persisted)
- `/home/matt/Development/helio/.concertino/runs/HEL-1351/evidence/.eval-hel1351/c2/e2e-green{,-2,-3,-4}.log` (unmutated: 5/8 pass; 3 null-read failures)
- `.../c2/e2e-mutA-{1,2}.log` with `.../c2/mutA.diff`, and `.../c2/e2e-mutB-{1,2}.log` with `.../c2/mutB.diff`
- `.../c2/jest-frontend.log`

Test data: every dashboard, pipeline, output and source the e2e runs created was deleted by the spec's own `finally`. A recount of the exact ids (16 of each) returned 0. 18 throwaway `@example.test` users remain (ids are in the logs, including 2 from an initial run that failed at login before seeding). matt@helio.dev was not touched.
