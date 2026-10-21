## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `990e5d7488eb931b5c914d299650c4be98729188` against the live-resolved base `edd3a028fa070f126d36993eba7fb8afa27c7d37` (`resolve-review-base.sh`, exit 0). One commit, 26 files. The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=feature/phone-refresh-control-tidyups/HEL-1681`.

### What I verified (with evidence)

**Diff read in full** (`git diff BASE...HEAD`, plus `-w` for PanelList.tsx). The PanelList change is only the wrapper: one `<PhoneDashboardRefreshProvider>` around the whole `<section>`, at every width. The rest of the 381-line diff is re-indentation.

**Gates, run fresh** (nice 19, 2 workers):
- Targeted frontend jest (pullRefreshRegistry, MobilePanelStack*, PullRefreshIndicator, DashboardRefreshLine, usePullToRefresh, PanelList), with `HELIO_JEST_MAX_WORKERS=2`: 19 suites and 171 tests passed.
- Frontend `typecheck`, `lint` (0 warnings) and `format:check`: all clean.
- Root `eslint --max-warnings=0` and `prettier --check` on the two changed e2e specs and DESIGN.md: clean, exit 0.
- `hel1681-refresh-control.spec.ts` + `hel1656-pull-to-refresh.spec.ts`, under the e2e flock with `--trace retain-on-failure`: **32 passed (1.4m)**. This includes HEL-1682's :221.
- `hel1575-dashboard-tabs.spec.ts:593 --repeat-each=10`: **10 passed**. This is in addition to the executor's 40/40 and the evaluator's 24/24. The executor's base run file shows 1 failure in 16.

**AC1: the refresh control is keyboard- and single-tap-operable, and its e2e failed first.**
- The button is `DashboardRefreshLine.tsx` `RefreshButton`, which calls `registry.start("button")` on the shared registry. The registry is owned by `PhoneDashboardRefreshProvider` in `pullRefreshRegistry.ts`.
- The e2e asserts that a tap and an Enter each send exactly 3 rows GETs and 0 run POSTs, that the status region says `["Refreshing","Refreshed"]`, that focus is kept, and that a second activation while busy sends nothing.
- `red-first-run.txt` exists in the executor's scratch. It shows 11 failures on base. The 3 passes are the absence checks, which correctly pass on base.

**Items 2-4: fixed or measured.**
- Item 2 (collapsed chart). The executor's `before-375-light-full-rest.png` is a base capture. It shows the collapsed chart: the axis is drawn but there are no bars. The root-cause note (`item2-collapsed-chart-measurements.md`) is probe-backed: ECharts initialises during the Crossfade skeleton exit and gets 24px. The fix gives the canvas a definite 100px, scoped to `.mobile-panel-stack__item--output`. In my 12 phone loads (375 and 430, light and dark, Full/Subtle/Off) the canvas was 100px every time and the bars rendered (`sk-375-light-full-rest.png`). The e2e asserts the canvas is at least 100px, and a CSS guard test pins the rule.
- Item 3. `MobilePanelStack.css.test.ts` guards that the CSS value equals `PULL_HOLD_PX`. The executor recorded a 52px mutation that turned it red.
- Item 4. The `done` phase holds from the release to the end of the settle. The e2e asserts the label sequence `["Pull to refresh","Release to refresh","Refreshing","Refreshed"]` exactly, and it passed in my run.

**Item 5: triaged.** The fix is test-only, and its mechanism matches the code: the offset is `serverNow - Date.now()`. My 10/10 repeat run above confirms it.

**C1 (tap area measured).**
- The e2e measures the tap area with `elementFromPoint`: four corners plus the centre, a point 1px below, the chip's centre and the chip's top edge.
- My own geometry dump agrees. The button is 19.19 x 19.19 at y=76, at the inline end of the line, at x=343.8 (375) and 398.8 (430). The line spans x 12..363 / 12..418, so the button's right edge is flush with the cards' right edge.

**C2 (no remount across 768px).** The provider is `createElement(PullRefreshContext.Provider, …)` with no DOM of its own, and it is mounted unconditionally. The e2e "crossing 768px keeps the same zoom container" passed.

**Desktop unchanged.**
- Panels register only inside `MobilePanelStack` (`grep usePullRefreshRegistration`), so the provider's registry stays empty at 1280.
- In my 1280 run the button count was 0 and the refreshed line count was 0 (`sk-1280.png`).
- The executor's `before-1280.png` and `after-1280.png` are byte-identical in size (68111 bytes each). The evaluator separately reported a pixel diff of None.

**Layout stability.** The stack top was 155.1875 in all 12 phone combinations. That matches the evaluator's base reading of 155.19 in `probe-before.jsonl`, so the button adds no shift.

**Visual judgment.** I took my own screenshots: 375 and 430, `isMobile` + `hasTouch`, DPR 2, light and dark, under Full, Subtle and Off.
- The ghost glyph is muted and sits on the line's baseline at the trailing edge. It is token-coloured and reads as a quiet secondary affordance next to the mono refresh caption.
- While busy, the shared `Spinner` replaces the glyph at the same size, and the accent arc reads correctly in both themes.
- The `:focus-visible` ring follows the §8 recipe and is visible in both themes (`sk-430-dark-off-focus-top.png`).
- The chip row and the cards are untouched.
- No pull indicator appears during a button round, and the stack does not translate. The e2e asserts this.
- This is consistent with the sibling phone chrome.

**Persisted evidence:**
- `/home/matt/Development/helio/.concertino/runs/HEL-1681/evidence/.concertino/scratch/HEL-1681/skeptic/sk-375-light-full-rest.png`
- `…/sk-375-light-full-busy-top.png`
- `…/sk-430-dark-off-rest-top.png`
- `…/sk-430-dark-off-after-tap-top.png`
- `…/sk-430-dark-off-focus-top.png`
- `…/sk-1280.png`

My throwaway users (5) were deleted by the run's registry teardown. The servers were stopped with `stop-servers.sh`.

**mtime evidence.** No conclusion here depends on mtime ordering. The before/after desktop claim rests on file byte size plus the evaluator's pixel diff.

### Verdict: CONFIRM

### Non-blocking notes

These are reversible polish items. List them in the PR.

1. **Sticky hover after a tap (reproduced).**
   - After a tap round the glyph stays at hover colour (`--app-text`) and keeps the `--app-surface-soft` fill until the next tap elsewhere. Compare `sk-430-dark-off-after-tap-top.png` (bright glyph) with `sk-430-dark-off-rest-top.png` (muted). The fill is also visible in `sk-375-light-full-busy-top.png`.
   - DESIGN.md has no binding rule on this. The closest phone sibling (`MobileNavSheet.css`) is ungated too, and the chip row has no hover at all. HEL-1668 D5, however, gates hover fills on the phone pipeline surfaces with `@media (hover: hover)` so that a tap never leaves a fill stuck.
   - Recommended follow-up: wrap `.dashboard-refresh-line__button:hover` (`DashboardMetaRow.css:136`) in `@media (hover: hover)`.
2. **The `jumped` flag in `e2e/hel1575-dashboard-tabs.spec.ts:622-630` is dead.**
   - The flag is set before `fastForward`, so the `!jumped` branch never runs, and the comment "once the jump has happened" misdescribes the code.
   - It is harmless: an early-landing response only makes the tab more expired, and the test passed 10/10 for me.
   - Drop the flag, or set it after `fastForward`, in a follow-up.
3. **`useState(registry.busy)` has no guard test.**
   - In practice the scenario is unreachable: unmounting the stack unregisters every panel, which ends the round (`register()` cleanup → `round.delete` → `settleIfDone`). So a newly mounted stack always sees `busy === false`.
   - The line is defensive and correct; a test would be optional.
4. **`PanelList.tsx` is now 548 lines.** It was already over the threshold before this change (543). Mention a split candidate in the PR.
5. **DESIGN.md/CSS comment figure.** The comment says the chip row starts at y ≈ 47.2. The running app puts it near 53.2 (about 9px of spare space, not 3.2). It is a comment-accuracy nit.
