## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: aa754f29df6b8d9607ec0ec801bf16af6cafdd06. Delta reviewed: d8ea073b5..aa754f29d, covering `e2e/hel1351-aggregated-chart-overlay.spec.ts` and `PanelCard.aggregateChart.test.tsx`. Base a606a9833 was re-resolved live.

### Phase 1: Spec Review — PASS
- Cycle-2 CR1 is addressed. After the 390px resize, the spec waits for `.react-grid-item` to reach count 0. Both the compact and the plain mobile-stack panels are now read inside `expect.poll`, and the assertions run on the captured snapshot. Nothing is read a second time.
- The cycle-2 non-blocking suggestion (a unit test for the `PanelCard.tsx:468-472` Inspect guard) is also adopted.
- The delta adds no scope. C1 and C2 are unaffected.

### Phase 2: Code Review — PASS
Gates, run fresh by me on aa754f29d (logs in `.eval-hel1351/c3/`; every gate under `nice -n 19`, jest capped at 3 workers):
- `npm run lint` exited 0, `npm run format:check` 0, frontend `tsc --noEmit` 0, and `npm --prefix frontend run build` 0.
- Root jest passed 376/376. Frontend jest passed 460 suites and 4841/4841 tests, one more than cycle 2, which is the new guard test.

Independent verification ran in a throwaway detached worktree at aa754f29d. It had its own pinned Vite on 6793, proxying to the lane backend on 9690, with the Origin header rewritten in that worktree's `vite.config.ts` only. Every run used `--workers=1` under `nice -n 19`. The worktree has been removed, and its Vite was stopped by exact PID.
- **Stability, unmodified spec:** I ran `--repeat-each=6` twice, giving **24/24 passed** (12 light, 12 dark). The same harness failed 3/8 on d8ea073b5. If the failure rate were still 37%, the chance of 24 straight passes would be below 1e-4.
- **Mutation A** reverts the compact-legend rule (`(effectiveCompact && !overlayApplied) ||` → `effectiveCompact ||`). Result: **6/6 red**, every one at line 293, `expect(withOverlay!.legendShow).toBe(true)`.
- **Mutation B** makes the compact legend unconditional, with both `overlayApplied` guards removed. Result: **6/6 red**, every one at line 308, `expect(withoutOverlay!.legendShow).toBe(false)`. The restructured spec catches it at the intended assertion, and no flake masks it.
- **Guard mutation** removes `|| !panelData.paginationRows` from `PanelCard.tsx`. The new unit test "Inspect falls back to raw-row keying while no record rows are loaded" goes red (1 failed, 6 passed). With the code restored, all 7 pass.

### Phase 3: UI Review — PASS
- The delta changes no UI code. Items 1, 3 and 4 were verified live in both themes and at all breakpoints in cycle 1 (evaluation-1.md).
- The 24 stability runs and the 12 mutation runs in this cycle exercised item 1 (grouped bars, sum(amount), "vs 7d" via tooltip) and item 3 (a genuinely compact canvas under 179px, with a scroll legend only when an overlay is drawn) live in both themes against real history.

### Overall: PASS

### Non-blocking Suggestions
- `liveChart`'s fiber walk is local to this spec. Extract it to `e2e/support/` if a second spec needs it.
- The spec registers users it never removes. This is a repo-wide pattern.

### Evidence (persisted)
- `/home/matt/Development/helio/.concertino/runs/HEL-1351/evidence/.eval-hel1351/c3/e2e-green.log` and `.../c3/e2e-green-2.log` (12 + 12 passed)
- `.../c3/e2e-mutA.log` with `.../c3/mutA.diff`, and `.../c3/e2e-mutB.log` with `.../c3/mutB.diff` (6/6 red each)
- `.../c3/mutGuard.diff`, `.../c3/jest-mutGuard.log`, `.../c3/jest-guard-restored.log`
- `.../c3/jest-frontend.log`

Test data: each of the 36 e2e executions deleted its own dashboard, pipeline and source in `finally`. A recount of all 36 ids for each of source, pipeline, output and dashboard returned 0. The 36 throwaway `@example.test` users remain; their ids are in the logs. matt@helio.dev was not touched.
