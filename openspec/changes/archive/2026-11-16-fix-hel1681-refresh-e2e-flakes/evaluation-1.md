## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 2ff99ff699fc089c9c22084fc6ff572b30033b60. Base (resolved live): 1d2fa5ab1c8a7e84a7e662a6181a893c52d6236d.
Changed code: `e2e/hel1681-refresh-control.spec.ts` only; the other changed files are change-dir artifacts under
`openspec/changes/fix-hel1681-refresh-e2e-flakes/`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (no bare `.mobile-panel-stack__item` measurement before `waitForPanelStack`): met. `openDashboard` now calls
  `waitForPanelStack(page, 4)`, which waits for the live-layer count and then for `getByLabel("Loading panels")` to reach 0.
  `MobilePanelStackSkeleton` renders inside `PanelGridSkeleton`'s `aria-label="Loading panels"` shell, so this is a real
  wait for the skeleton to unmount. The Full-motion box read uses `LIVE_STACK_ITEMS` and throws a clear error on a null
  box. The only remaining bare stack-item reads are after `openDashboard` (the tap test's canvas height) or are
  non-measuring counts of a class the skeleton never renders (`--markdown`, `--output`).
- Live count of 4: confirmed by my own run. `toHaveCount(4)` is exact, and 45/45 runs passed.
- AC2 (count check can fail): confirmed by my own mutation (below).
- AC3 (green in repeat runs at 2 workers): 45/45 in my own run (see Phase 2).
- Root cause (`root-cause.md`): matches the code. `usePanelData.refresh` returns early when `inFlightRef.current` is set
  (`usePanelData.ts:131`). `PullRefreshRegistry.start` seeds `seen: entry.isRefreshing` and calls `refresh()` on each entry
  (`pullRefreshRegistry.ts:103-111`), so a press during the initial loads sends no GETs, and the round ends when those
  loads settle. The old gate's `.ui-spinner` count-0 check does not prove the loads have finished.
- Scope: test-only, with no product change. That matches the design's fix rule for a test-side race.
- Constraints C1-C7: honored. No timeout was lengthened (C6). The fix waits for the real precondition: no rows GET still
  in flight.
- Tasks: all checked, and they match the diff.

### Phase 2: Code Review — PASS
Gates (my own runs in WORKTREE_PATH; only `e2e/**` and change-dir files changed, so the frontend build, jest and backend
gates do not apply):
- `eslint --max-warnings=0 e2e/hel1681-refresh-control.spec.ts`: clean
- `prettier --check` on the spec and the change dir: clean
- `npm run check:e2e-types`: clean
- `frontend/node_modules/axios` is 1.21.1

Spec runs (servers on 7163/10070, workers 2, `nice -n 19`):
- New spec, unforced, `--repeat-each 3`: **45 passed / 0 failed** (load average 1.8 rising to 8.9).
- Forced repro: every initial rows response delayed 1000 ms via a route registered before `goto`. I ran it on scratch
  copies of the old and new spec, with no edits to the worktree.
  - OLD spec, `keyboard|second activation|single tap`, x2: **8 failed / 4 passed**. Keyboard failed 4/4 with
    `Expected: 3 / Received: 0` at the request-count poll, which is the CI #1133 text exactly. The second-activation
    test failed 4/4 at the same poll. In my runs `aria-disabled` was seen, so this repro does not hit the
    "aria-disabled never true" variant. The executor reached that variant with a release timed 0 ms after the tap. The
    mechanism is the same and only the timing differs, which is consistent.
  - NEW spec, same forcing: **11 passed / 1 failed**. The one failure was a `page.goto("/login")` load timeout inside
    `registerAndLogin`. That is before the forcing route exists and outside the code under review: an environment
    hiccup, not this race.
- The executor's unexplained 800 ms `single tap` failure (38/39): I re-ran the new spec at a forced 800 ms on
  `single tap` x8 (**16/16**), then `single tap|keyboard|second activation` x10 (**60/60**, load average 7-10.6).
  Including the executor's 16 further runs, that is 92 forced runs with no recurrence. The mechanism also argues
  against a race the fix misses. After the fix, `openDashboard` waits until no rows GET is in flight
  (`requestfinished`/`requestfailed`) plus two animation frames. That is the exact precondition `refresh()` needs.
  `single tap` also does the most work between gate exit and press (the canvas check), so of the three tests it is the
  least exposed to this race. Its failure message was not recorded, so it cannot be attributed. Treated as
  non-blocking (see suggestions).
- D3 mutation (my own): an init script appends a `.mobile-panel-stack` div once the live grid's `.react-grid-item`s
  exist, simulating a stack that wrongly renders at 1280. Result over 2 repeats each:
  - OLD order: 1 red, 1 green. The check sometimes ran before the grid mounted, so it is unreliable/vacuous.
  - NEW order: 2/2 red, `Expected: 0 / Received: 1` at the count-0 line. The check can fail.

Code quality:
- `countRequests` keeps an in-flight set keyed on the `Request` object, which is correct for Playwright's
  `request`/`requestfinished`/`requestfailed` events. `isRowsGet` removes the duplicated predicate.
- The shift-test sampler now passes `LIVE_STACK_ITEMS` into `addInitScript` as an argument rather than inlining a second
  copy of the string. Good.
- Comments explain why, at the point of use. No dead code, no `!` on the box read, no magic values.

### Phase 3: UI Review — N/A
No file matches the UI triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The change is a
test-only spec edit plus change-dir artifacts. The spec itself was run against live servers above.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `root-cause.md` "Green after" says the 800 ms single-tap failure is covered by "the final repeat-each result in the
  report", but no report in the change dir holds it. Either state the outcome inline or remove the pointer. A future
  occurrence should record the failing assertion line, so it can be attributed (e.g. to the tap test's
  canvas-height check, a separate product flake, rather than to the refresh race).
- The Full-motion red-first used a forced stub detach rather than a natural ordering. The fix removes the possibility
  structurally (scoped selector plus wait for skeleton unmount), so this does not weaken it. The red-first is simply
  more synthetic than the other repros.
