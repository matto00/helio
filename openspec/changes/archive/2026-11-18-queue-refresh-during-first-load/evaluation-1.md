## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: 688efb260e7e8b0ce5b1f84430af1a4f207f4ee4 (base f2358c16d, resolved live with resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

The behaviour matches the plan. The ticket ACs are met (Queue was chosen and stated in design D1; e2e red on main; hel1681 green). The non-retired CONSTRAINTS C1-C14 are honoured in the diff. There is no scope creep: the source change is limited to `usePanelData.ts`, a one-line edit in `MobilePanelStack.tsx`, and comments in `pullRefreshRegistry.ts`. The spec delta matches the implemented behaviour.

Issue: task 3.1 is marked `[x]` "jest `usePanelData` queue tests per design D5", but D5's list is only partly implemented:
- D5 requires a drain test "after both `subscribeWait` settles and at the `isReusable` return". None exists.
- D5 requires that "`drop` ... on binding loss returns `isRefreshing` to false". The test that claims this is vacuous (see Phase 2).
- skeptic-design-2.md made two notes binding: the "drain only if latest request" guard and the CROSS_FILTER_EQ_REJECTED drain at the retry's settlement. Neither has a test.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint` passes.
- `npm run format:check` passes.
- `npm run typecheck` passes.
- `npm test` (jest, 3 workers): root 66/66 suites (579 tests); frontend 812/812 suites (9854 tests); exit 0.
- `npm --prefix frontend run build`: exit 0.

Affected jest files all pass: usePanelData* (48 tests), MobilePanelStack* and pullRefreshRegistry (11 suites, 63 tests).

The implementation reads correct. I traced each drain and drop site against D2:
- `latestFetchRequestId` is set on `pending` and never cleared (`panelsSlice.ts:358`), so the stale-request guard compares correctly.
- `fetchPanelPage` has no `condition` that could skip a dispatch and strand `queued`.
- Returning `retry` from `.catch` makes `.finally` wait for the retry to settle, as D2 requires.

**Tests do not cover most of the new code paths.** I re-ran the mutations myself, in a throwaway detached worktree at 688efb260 that I removed afterwards. The delivery worktree was never touched. I ran the usePanelData* jest files against each mutation:

| # | Mutation (`usePanelData.ts`) | Result |
|---|---|---|
| M1 | remove `drain()` at subscribeWait "already settled" (:214) | **survives** (48/48 pass) |
| M2 | remove `drain()` at subscribeWait store-listener settle (:225) | **survives** |
| M3 | remove `drain()` at the `isReusable` return (:308) | **survives** |
| M4 | drop the `latestFetchRequestId === lastRequestId` guard (:382) | **survives** |
| M5 | `.catch` CROSS_FILTER retry: `return;` instead of `return retry;` | **survives** |
| M6 | drop `!mountedRef.current` from `drain` | survives (redundant: unmount cleanup already clears `queuedRef`) |
| M7 | `setQueued(false)` at drain time (executor's Mutation B) | red (1 failed) — confirmed |
| M8 | `isRefreshing` without `|| queued` | red (1 failed) |
| M9 | remove `dropQueued()` in the no-key branch (:258) | **survives** |
| A | `MobilePanelStack` registers `panelData.refresh` | red (2 failed in MobilePanelStack*) — confirmed |

M9 survives because the binding-loss test ("losing the Output binding drops the queue", `usePanelData.test.ts`) rebinds to a text panel. The hook's no-key early return hard-codes `isRefreshing: false` (`usePanelData.ts` ~:411), so the assertion holds whether or not `dropQueued` runs. The test claims a guarantee it does not check.

Other checklist items:
- No CONTRIBUTING mechanical violations found.
- There is no UI styling change, so the DESIGN mechanical rules do not apply.
- No dead code.
- Type safety is fine, apart from the optional member noted below.

### Phase 3: UI Review — PASS

Servers ran through start-servers.sh on 7170/10077, against the lane-private DB `helio_hel1738` (the backend log shows only that JDBC URL). assert-phase servers: PASS.

I ran three spec files in full with 2 workers: `e2e/hel1738-refresh-during-first-load.spec.ts`, `e2e/hel1681-refresh-control.spec.ts` and `e2e/hel1656-pull-to-refresh.spec.ts`. Result: **39 passed** (2.0 min). The fixture deleted the throwaway users by recorded id.

That run covers:
- touch at 375 and 430, and a non-touch mouse context at 375, each in light and dark;
- three presses (tap or click, a coordinate press, Enter);
- request counts N then 2N, at most one concurrent request per URL, no run POST;
- status log exactly ["Refreshing","Refreshed"], with `aria-disabled` held until the queued request settles;
- at 1280: no button and no `.mobile-panel-stack`.

I viewed the busy and settled screenshots my own run produced. The busy spinner shows on the button in light and dark, and the layout is not broken at 375 or 430.

Persisted refs:
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval1/busy-touch-375-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval1/busy-touch-375-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval1/busy-mouse-375-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval1/busy-touch-430-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval1/settled-touch-430-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval1/settled-touch-430-dark.png

No claim here depends on mtime ordering. Each busy/settled pair is identified by the file name the spec wrote.

I re-ran the e2e mutations at unit level (A and M7, both red). I did not re-run the e2e red-on-main myself, because that would mean reverting sources in the delivery worktree. The executor's logs (`.concertino/scratch/HEL-1738/red-main.txt`, `red-mutA.txt`, `red-mutB.txt`) show the failing assertion the design predicted: held on B = 0 on main, and `aria-disabled` lost under Mutation B. That agrees with the code: `refresh()` on main returns early while a request is in flight.

Console errors were not captured separately. The spec does not listen for them, and no flow showed an error state.

### Overall: FAIL

### Change Requests
1. **Kill M1 and M2: subscribeWait drains.** In `frontend/src/features/panels/hooks/usePanelData.test.ts`, add a test where the hook waits on a request another party owns (the `mountOwnership` / `waitForOwnedRequest` path, as the existing HEL-1392 ownership tests set it up). Call `queueRefresh()` while that request is pending, settle it, and assert exactly one more rows request is sent and `isRefreshing` never reads false in between. Cover both branches:
   - the store-listener settle (`usePanelData.ts:225`);
   - the "entry already settled" return (`:214`), which may be reachable only in the remount/StrictMode case `usePanelData.remountReuse.test.tsx` already exercises.
   Each test must go red when its `drain()` line is deleted.
2. **Kill M3: the `isReusable` drain (`usePanelData.ts:308`).** Add a test that reaches the `isReusable` return with a refresh queued, so a non-refresh effect re-run lands on a reusable window, and assert the queued refresh is then sent. If that state cannot be reached with a refresh queued, show why in design.md and delete the `drain()` call rather than keeping untested code.
3. **Replace the vacuous binding-loss test so it kills M9.** Use this sequence:
   1. While out-1's first load is in flight, call `queueRefresh()`.
   2. Rebind to a non-output panel, so the effect's no-key branch runs.
   3. Rebind to out-2 and resolve both loads.
   4. Assert out-2 gets exactly one request (no stray queued drain) and `isRefreshing` ends false.
   It must go red with `dropQueued()` removed from the no-key branch (`:258`). The current text-panel-only version passes under that mutation because the no-key early return hard-codes `isRefreshing: false`.
4. **Kill M4 and M5: the guards skeptic-design-2.md made binding.**
   - Stale guard: queue during out-1's load, rebind to out-2 before out-1 settles, then resolve out-1 first. Assert no request is sent at out-1's settlement while out-2 is still pending, then the queued refresh is sent after out-2 settles.
   - CROSS_FILTER retry: make the first request reject with `CROSS_FILTER_EQ_REJECTED` (non-explicit path) with a refresh queued. Assert the queued request is not sent until the retry settles, so there is never an overlap.
   Each test must go red under its mutation (drop the `latestFetchRequestId` comparison at `:382`; `return;` instead of `return retry;`).
5. **Update `red-first-evidence.md`** with the mutations above and their red results, so the evidence covers every drain/drop site D2 lists.

### Non-blocking Suggestions
- `queueRefresh?` is optional on `PanelDataResult`, but design D2 specified a required member. The real reason it is optional appears to be that `usePublicPanelData` also returns `PanelDataResult`, not the "test doubles" the JSDoc gives. Either state that reason in the JSDoc (`usePanelData.ts:62`), or make the member required and supply it from the public hook. The `?? panelData.refresh` fallback in `MobilePanelStack.tsx:79` would then be unnecessary.
- `e2e/hel1738-refresh-during-first-load.spec.ts:242`: the test title says "the first load sends one request per panel", but nothing asserts a request count. Either assert it or rename the test.
- `usePanelData.ts` is now 488 lines, past CONTRIBUTING's ~400-line threshold. Propose a split in the PR description.
- The pull gesture's queued path is covered only through the shared `start()` path (unit-level). That is acceptable per D4; noted for the skeptic.
