## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `990e5d7488eb931b5c914d299650c4be98729188` against base `edd3a028fa070f126d36993eba7fb8afa27c7d37` (resolved live with `resolve-review-base.sh`).
Evidence directory: `/home/matt/Development/helio/.concertino/scratch/HEL-1681/eval/` (`eval-probe.jsonl` plus screenshots `eval-<width>-<theme>-<motion>-{rest,button-busy,focus}.png` and `eval-1280.png`). These are the evaluator's own captures from the running app at HEAD, and they sit outside the worktree, so `cleanup.sh --phase4` does not remove them.

### Phase 1: Spec Review — PASS
- AC1, item 1 (keyboard- and single-tap-operable, with a red-first e2e). `scratch/HEL-1681/red-first-run.txt` shows the spec run on base. 11 tests fail on the missing button. The 3 that pass are absence checks (no button with no output panel, and no button at 1280), and passing on base is correct for them. On HEAD the full spec passes (my run: 15/15, plus `hel1656-pull-to-refresh.spec.ts` 17/17).
- AC2, items 2-4 ("fixed or measured"): all three are fixed. Item 2 is covered below under Phase 3 and the specific points. Item 3 has a jest guard. For item 4, the label sequence on base was `[Pull to refresh, Release to refresh, Refreshing, Pull to refresh]`; on HEAD it is `[..., Refreshing, Refreshed]` (`probe-before.jsonl` / `probe-after.jsonl`), and the new e2e asserts the HEAD sequence.
- AC3, item 5 (triage): triaged, with a small test-only fix (see below).
- Tasks 1.1-6.3 are all marked done and match the diff. There is no scope creep. The Table `touch-action` bug was not touched.
- Spec delta `mobile-dashboard-pull-refresh` matches the implementation.
- Standing constraints:
  - C1: the tap area is measured with `elementFromPoint` in e2e, and again by the evaluator in the running app at 375 and 430.
  - C2: `PhoneDashboardRefreshProvider` renders no DOM and is mounted unconditionally around the whole `<section>`. The 768px-crossing e2e passes and asserts the same `.panel-list__zoom-container` node with a non-zero width.

### Phase 2: Code Review — PASS
Gates, run fresh by the evaluator in WORKTREE_PATH with `nice -n 19`:
- `npm run lint`: clean, 0 warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test` with `HELIO_JEST_MAX_WORKERS=2`: root 61 suites / 524 tests passed; frontend 749 suites / 9300 tests passed; exit 0.
- `npm --prefix frontend run build`: OK.
- Playwright (under the e2e flock, 2 workers, `--trace retain-on-failure`):
  - `hel1681-refresh-control.spec.ts` + `hel1656-pull-to-refresh.spec.ts`: 32/32 passed.
  - `hel1575-dashboard-tabs.spec.ts:593 --repeat-each=24`: 24/24 passed.

Guard mutations. I re-ran these in a throwaway detached worktree at HEAD, which has since been removed. Every guard turned red:
- The chart-height CSS rule replaced: `MobilePanelStack.css.test` failed 1.
- Indicator rendered for any busy round (D4): `MobilePanelStack.pullRefresh` failed 1.
- The stack disposes the shared registry (D1): `MobilePanelStack.pullRefresh` failed 1.
- `roundSource` not cleared in `end()`: `pullRefreshRegistry.test` failed 1.
- The button uses `disabled` instead of `aria-disabled`: `DashboardRefreshLine` failed 1.
- The button calls `start("pull")`: `DashboardRefreshLine` failed 1.
- Executor-recorded mutations, consistent with the above: `PULL_HOLD_PX`/CSS 52px (red), indicator `done` mapped to the pulling label (red), entry notifications on every register (red), button rendered without entries (red).

Code quality:
- Typed throughout, with no `any`.
- Ghost-recipe tokens are used (`--app-text-muted`, `--app-surface-soft`, `--app-radius-sm`), and the sizes are derived from tokens.
- The sub-24px hand-rolled control is justified in a code comment against DESIGN.md §5, and carries both `aria-label` and `title`.
- No dead code or TODOs.

### Phase 3: UI Review — PASS
I ran the evaluator probe at HEAD on servers started with `start-servers.sh` on 7113/10020. Contexts used `isMobile` + `hasTouch` at 375x812 and 430x932, in light and dark, under Full, Subtle and Off motion (12 combinations); 1280 had no touch.
- Happy path:
  - A tap and an Enter keypress each fan out exactly 3 rows requests and 0 pipeline-run POSTs.
  - The status region announces exactly `["Refreshing","Refreshed"]`.
  - A second activation while busy sends nothing.
  - Focus is kept through the round.
- Tap area, the same in all 12 combinations:
  - The `::after` box is 44x44, its top is at y=0 of `.panel-list`, and it lies inside `.panel-list`.
  - All four corners hit the button, and a point 1px below the box does not.
  - The chip row starts at y=53.2 (the design estimated 47.2), and its top edge still hits the chip.
- Resting stack position: the stack top is 155.2 in every combination, the same as base's 155.19 (`probe-before.jsonl`), so the button causes no layout shift.
- Chart card (item 2):
  - The canvas is 100px in all 12 combinations.
  - 20 of 20 cold loads under Full motion, each with a fresh context and a fresh user (10 at 375, 10 at 430), gave a 100px canvas and a 166px card.
- Desktop 1280:
  - No button, no stack.
  - The chart canvas is sized by the grid (259x258).
  - The executor's `before-1280.png` and `after-1280.png` are pixel-identical (PIL difference bbox = None).
- Console: the only errors were one 401 per run, which happens during the login probe before authentication. Neither the feature nor any tested flow produced any.
- Screenshots: busy (spinner in place of the glyph) and the focus ring were checked in light and dark.

### Specific points raised by the orchestrator
- **Item 2: root cause or masking?** This is a root-cause fix.
  - The probe showed that the chart's size was decided by whatever layout existed when ECharts first measured an indefinite-height container. When the Crossfade's leaving skeleton was still present, that was 24px; otherwise zrender fell back to 100 from `parseInt("100%")`. The size then held itself in place through ECharts' inner div.
  - Giving the canvas a definite height removes the dependency on first-measure timing; it does not hide a symptom.
  - The pin is correct for every chart kind in the stack. Since HEL-909 the stack only renders `output` placements, and `computeMobilePanelHeight("output")` returns `height: null`, so there is no per-kind height policy for the pin to conflict with. The `--chart`/`--metric` fixed-height rule is dead pre-HEL-909 CSS. Every chart type (bar, line, pie, histogram, and so on) goes through `ChartRenderer`'s `.chart-panel__canvas`, and on base every one of them landed on the same accidental 100px on the happy path.
  - The selector is scoped to `.mobile-panel-stack__item--output`, so desktop is unaffected.
  - The "before" rate (10/24) came from the branch minus the CSS fix rather than from base. The branch's other changes do not touch the chart's layout path, and the rate matches the ticket's "1 in 4" order of magnitude, so this is acceptable.
- **Item 5: is the test-only fix sound?**
  - The mechanism is consistent with the code: `refreshChangeSignals.ts:22` sets the offset to `serverNow - Date.now()` on each signals response.
  - The fix advances the server's clock by the same 16 minutes as the client's, which is what real elapsed time would do. Every assertion is kept: the panels refetch for tab B, and so do the rows.
  - Base failed 1 in 16 in the executor's run. HEAD passed 40/40 (executor) and 24/24 (evaluator).
  - One nit, below: the `jumped` flag is set before `fastForward` runs, so it does not gate what its comment says it gates. This does not weaken the test: a response that lands early only makes the tab more expired.
- **Item 4:**
  - Fixed, not measured in ms. Phase `done` holds from the release to the end of the settle, so the "Pull to refresh" window is 0 by construction, and the e2e asserts the full label sequence under Full motion.
  - Subtle and Off are unchanged against base: `[Pull to refresh, Release to refresh, Refreshing]` with no settle, in both the executor's probe and the new code path, because `release()` still sets `idle` plus `clearMotion` when the content does not follow the finger.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `e2e/hel1575-dashboard-tabs.spec.ts:622-630`: `jumped` is set to `true` before `page.clock.fastForward`, so the `!jumped` branch is effectively dead and the comment ("once the jump has happened") misdescribes it. Either drop the flag or set it after `fastForward`.
- Design D5 asked for the settle window in ms before and after. The PR body should say plainly that the post-fix window is 0 by construction, and give the before/after label sequences as the measurement.
- `DashboardMetaRow.css:82`: `:hover` on the button sticks after a tap on touch devices (visible in `eval-430-dark-off-button-busy.png`). The shared `IconButton` Ghost recipe does the same, so this is not a mechanical violation. It is noted for the skeptic's visual judgment, with `@media (hover: hover)` as an option.
- `MobilePanelStack.tsx`: `useState(registry.busy)` (D3, initial busy from the shared registry) has no guard. Mutating it to `useState(false)` keeps every test green. Optional: add a test that mounts the stack while a button round is already running.
- `PanelList.tsx` was 543 lines before this change and is now 548. That is already over CONTRIBUTING's ~400-line threshold, so the PR could mention a split.
- `DESIGN.md`/CSS comment: the chip row was measured at y=53.2, not about 47.2, so there is about 9px to spare rather than 3.2px.
