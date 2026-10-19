## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: `84135b06af57f8b28a393ba930c167b5aacbf280`. The diff base was resolved live: `d0c600fbf216cf8ad9cef686dbbe07be0f43b96c`.
Evidence root (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1656/evidence/.concertino/scratch/HEL-1656/eval/`, called `EV/` below.

### Gates (run fresh by the evaluator)
| Gate | Result | Evidence |
|---|---|---|
| `npm run lint` | exit 0 | `EV/lint.log` |
| `npm run format:check` | exit 0 | `EV/format.log` |
| `npm run typecheck` | exit 0 | `EV/tc.log` |
| `npm test` (root 61 suites / 524 tests; frontend 735 suites / 9177 tests) | exit 0 | `EV/jest.log` |
| `npm --prefix frontend run build` | exit 0 | `EV/build.log` |
| Playwright: hel1656 + hel1583/1584/1646/1668 specs, 2 workers, `--trace retain-on-failure` | see below | `EV/pw.log`, `EV/pw5.log`, `EV/pw7.log` |

C1 disclosure: in the root `npm test -- --maxWorkers=2` call, the flag applied only to the root jest run. The frontend jest then used its local default of 3 workers (under `nice -n 19`), so it exceeded C1's cap of 2. Every other heavy run kept to 2 workers, and every Playwright run waited for the load gate (1-minute load below 10) and took the e2e lock. A throwaway base-commit worktree was used for comparison runs and has been removed (`git worktree list` shows no straggler). Test users were deleted by the e2e global teardown, which deletes by recorded id.

Playwright on the final head (flag a, the late `MobilePanelStack.css` edit):
- Run 1 (`EV/pw.log`, servers as found): 140 passed, 2 failed: `hel1656 … at 375 › an upward drag scrolls the page and never engages` and `hel1584 chart refresh › morphs the series`.
- In isolation the upward-drag test passed 8/8 (`EV/pw2.log`).
- Run 5 (`EV/pw5.log`, servers restarted fresh): 141 passed. All 16 hel1656 tests passed, and the only failure was the hel1584 morph test.
- Run 7 (`EV/pw7.log`, hel1656 + hel1584-motion-surfaces co-run): 30 passed, 1 failed: `hel1656 … at 390 › a short pull releases back with no request`, which threw `Error: no card` from `cardPoint`.
- hel1584 morph test attribution:
  - Base commit, same 125-test set: all passed (`EV/pw-base-full.log`).
  - Branch, same 125-test set without the new spec: all passed (`EV/pw6.log`).
  - Branch, isolated on fresh servers: 3/3 passed (`EV/pw4.log`).
  - Branch, co-run with hel1656 in run 7: passed.

  It failed only in the 142-test set under load (2 of 2). No code in the diff is on its path: it is a desktop 1440 Refresh-button test, and the trace shows the rows refetch did return the new data. I could not prove a root cause, so it is recorded as an unattributed load-sensitive failure, not as a Change Request.

### Phase 1: Spec Review — PASS
- AC1–AC7: each one is implemented as written; see the Phase 3 measurements.
- AC8: the e2e uses touch emulation at 375, 390 and 430, light and dark. The busy-state screenshot was missing; this evaluation captured it.
- Owner ruling `suppress-on-phone-dashboard` is honoured:
  - containment is scoped to `[data-pull-refresh]` under `max-width: 768px`;
  - the gesture engages at scrollTop 0 only;
  - each output-bound panel refreshes once, through the existing guard;
  - no pipeline run (zero `/runs` POSTs in e2e).
- Tasks are all ticked and match the code. There is no scope creep: the `useSheetSwipe`/`sheetMotion` edits are the planned D2 extraction and preserve behaviour (BottomSheet tests are green). Planning artifacts match the implementation.
- CONSTRAINTS C1 is honoured by the diff (no hand-edits to `shard-weights.tsv`, scratch-only evidence).

### Phase 2: Code Review — FAIL
Issues:
1. **DESIGN.md §4 [mechanical], the 768 boundary** ("JS that branches on it uses `useIsPhoneShell()` … never `useIsNarrowerThan(768)`"). `frontend/src/shared/motion/usePullToRefresh.ts:20` declares `PHONE_BREAKPOINT = 769` and `:93` calls `useIsNarrowerThan(PHONE_BREAKPOINT)`. This hand-rebuilds `PHONE_SHELL_QUERY` instead of using the canonical hook the rule names. It resolves to the same query today, but it is a second source of truth for the phone boundary, and it uses a magic number (769).
2. **DESIGN.md §1 [mechanical], inline style only for genuinely dynamic values.** `frontend/src/features/panels/ui/grid/PullRefreshIndicator.tsx:31` sets `style={{ "--pull-indicator-height": `${PULL_HOLD_PX}px` }}`, which is a compile-time constant. The same value is already declared in CSS at `MobilePanelStack.css:219` (`--pull-indicator-height: 48px`), and the CSS comment admits the duplication.
3. **Flaky new e2e (tests that would catch a real regression must be reliable).** `e2e/hel1656-pull-to-refresh.spec.ts` failed twice, in 2 different tests, across 3 full executions of the spec (48 test runs):
   - `cardPoint` (`:91-95`) calls `boundingBox()` without first waiting for the card to be visible. `openDashboard` only waits for a `toHaveCount(3)`, so on a re-render the first card can momentarily have no box, which caused `Error: no card` (`EV/pw7.log`).
   - `an upward drag …` (`:205`) polls for `scrollTop > 0` without first proving the scroller is scrollable and settled (`EV/pw.log`).

   CI shards with 2 workers on loaded runners. This will show up as intermittent reds.

Everything else is clean:
- Types are fully typed. The only cast is the conventional CSS-custom-property `as CSSProperties`.
- Listeners are removed on cleanup, and the attribute is removed on detach.
- Non-passive `touchmove` returns immediately when the touch is not engaged.
- The registry has no render loop: notifications fire only on change, `setRefreshing` is effect-keyed on the value, and there is a 15 s ceiling outside `shared/motion`.
- `motionPrimitiveLiterals.test.ts` registers both new files, and no literal durations appear.

Flag (b), the registry mutation survivors: **accepted as genuinely equivalent mutants.** Within a round:
- With the change-only early return in place, a `false` can reach the round only as a true→false transition. That means `seen` was already set, either by the `true` notification or by the start-time seed (`seen: entry.isRefreshing`). So removing the seen-true guard alone changes nothing.
- With the seen-true guard in place, a no-change `false` leaves `done` unset. So removing the early return alone changes nothing.

Each guard therefore masks the other. The test at `pullRefreshRegistry.test.ts:36` correctly records that only the joint mutation goes red. This is defensive redundancy, not a coverage gap.

### Phase 3: UI Review — PASS (objective checks)
Measured with touch emulation (`hasTouch`, `isMobile`, CDP `Input.dispatchTouchEvent`). Spec and logs: `EV/pweval.log`, `EV/pweval3.log`, `EV/pweval4.log`.
- Happy path: all of the following were observed at 375 and 430, light and dark, under Off and Full (Subtle at 375 light):
  - pull past the threshold shows `ready`;
  - release shows `busy` (rows requests held open by `page.route`), and the status region reads "Refreshing";
  - once the requests settle the indicator unmounts and the status region reads "Refreshed";
  - the stack transform returns to `none`.
- Busy state screenshots: `EV/shots/busy-375-light-off.png`, `busy-430-dark-off.png`, `busy-375-dark-full.png`, `busy-430-light-full.png`. Under Full the stack settles toward the 48px hold (sampled mid-settle at `translateY(72.4px)`).
- Motion: Off and Subtle stack transform measured `none` while held and while busy. Full measured `translateY(112px)` (the cap) while held.
- Console: the only errors were the pre-login `401` on `/auth/me` and a `localStorage` SecurityError. Both come from my harness's init script on `about:blank`. None occurred during any pull flow.
- Desktop 1280 (flag d): the same user and dashboard were rendered on branch (:7088) and base (:7090):
  - identical `.app-content` DOM-shape signature (length 6820 on both);
  - no `.mobile-panel-stack`, no `.mobile-panel-pull` or indicator, no `data-pull-refresh`;
  - `overscroll-behavior-y: auto`.

  Screenshots: `EV/shots/desktop-1280-branch.png` and `desktop-1280-base.png`. Desktop is unchanged.
- Accessibility: the indicator is `aria-hidden`; the status region (`role="status"`, `aria-live="polite"`) is always mounted.
- Flag (c), the snap pill over the first card's title (Off/Subtle, held or busy). Measured overlap with the first card's title text:
  - at 375: pill x 102–273 against title x 27–158, both vertically within y 163–191;
  - at 430: pill x 129.5–300.5 against title x 27–160.

  So roughly 30–56px of the title's tail is hidden for the whole hold and busy period (`EV/shots/held-375-light-off.png`, `held-430-dark-off.png`). No DESIGN.md [mechanical] rule is violated: tokens are used throughout, the pill has `pointer-events: none`, and it is transient. Whether it is acceptable is a [judgment] call deferred to the skeptic. The facts are above, and design.md D3 chose "over the first card's top edge" deliberately.
- Pre-existing, not attributable to this change: on the phone stack under Full, the chart card can stay collapsed (90px, axis only, no bars) after first load:
  - branch, no pull: 1 of 2 runs;
  - base commit, no pull: 1 of 4 runs (`EV/pweval4.log`).

  This is a spin-off candidate, not a change request here.

### Overall: FAIL

### Change Requests
1. `frontend/src/shared/motion/usePullToRefresh.ts:20,93`: remove `PHONE_BREAKPOINT = 769` and the `useIsNarrowerThan` call. Preferred: add an `enabled: boolean` option to `usePullToRefresh` and have `MobilePanelStack.tsx` pass `useIsPhoneShell()` (from `app/shell/useIsPhoneShell`); this keeps `shared/motion` free of an app-shell import. Alternatively, call `useIsPhoneShell()` directly in the hook. Update `usePullToRefresh.test.tsx`'s viewport-gate test to match (it should still go red when the gate is removed).
2. `frontend/src/features/panels/ui/grid/PullRefreshIndicator.tsx:31`: drop the inline `style` (and the now-unused `CSSProperties`/`PULL_HOLD_PX` imports). Keep the single CSS declaration at `MobilePanelStack.css:219`, and change its comment to say it must equal `PULL_HOLD_PX` in `usePullToRefresh.ts`.
3. `e2e/hel1656-pull-to-refresh.spec.ts`: de-flake the two observed failures.
   - In `cardPoint` (`:91`), `await expect(locator).toBeVisible()` before `boundingBox()`, and retry the box read with `expect.poll` rather than throwing on the first `null`.
   - In `an upward drag …` (`:205`), first assert the precondition `scrollHeight > clientHeight` on `.app-content` (polled), then drag.
   - Prove stability with `--repeat-each 5 --workers=2` for the whole spec. Record the run count in the PR body.

### Non-blocking Suggestions
- `usePullToRefresh.ts`: the busy-end effect's local `clear()` repeats `clearMotion()` from the attach effect line for line. A shared module-level `resetPull(target, wrapper)` helper would remove the duplication.
- Flag (c), for the skeptic's judgment: putting the snap pill over the gap above the first card, straddling the card's top border instead of `top: var(--space-2)` inside the header, would stop it covering the title.
- The `hel1584 … morphs the series` test failed only in the 142-test set under load. Watch it in CI; if it recurs, it is a test-timing issue in hel1584 (SSE refetch vs `refreshedAt`), not this ticket.
- Spin off the pre-existing collapsed-chart-on-first-load issue in the phone stack under Full (reproduced on the base commit).
