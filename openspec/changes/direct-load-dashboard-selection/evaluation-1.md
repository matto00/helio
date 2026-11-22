## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7b93e4f1e6954e667147a05959590bb9080e21d0` against the live-resolved base `07a1180016b8032c9c16f2514aa8a8c0319cb776`.

### Phase 1: Spec Review — FAIL

The ticket's acceptance criteria are met in behaviour:
- Fresh `/dashboards/:id` load, saved active tab, surviving tabs with none active, stored empty set and the grantee deep link each go straight to the target. The jest test records every selection value.
- The no-saved-tabs landing default and HEL-1575 hydration have no regression.
- The spec delta matches the implementation.
- The AppShell assertion change is legitimate (see Phase 2).

One standing constraint is not honoured:

1. **C1 is violated for the e2e request-log GUARD.** C1 says every GUARD names and runs the mutation that turns it red. `e2e/hel1624-direct-load-selection.spec.ts:10-12` names "remove the `dashboardTabs.hydrated` gate on the panel fetch in App.tsx" as that mutation. The recorded mutation run, `mutation-e2e-gate-and-reducer.txt` (gate removed and the reducer reverted), has exactly **one** `Error:` (`grep -c "Error:"` = 1), and it is the recents soft assertion at spec line 85. All three assertions are `expect.soft`, so a failing `ownRequests` assertion (lines 87-89) would also be listed. It is not. So the request-log assertion stayed green under its own named mutation. The ticket AC "No request for the wrong dashboard's panels on load (asserted from a request log, e2e)" therefore rests on a guard that has never been shown to fail.

Task 3.3 is also unticked in `tasks.md`. I ran the verification it lists myself (see Phase 2), and it is green.

### Phase 2: Code Review — PASS (with one evidence defect, counted under Phase 1 / C1)

Gates I ran fresh in `WORKTREE_PATH` (outputs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1624/eval1-*.txt`):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test` (3 workers): root 73/73 suites and 645 tests; frontend 918/918 suites and 10588 tests; exit 0
- `npm --prefix frontend run build`: exit 0
- Playwright, 2 workers, lane DB: `hel1624-direct-load-selection`, every `hel1575-*` spec and `hel1783-shared-dashboard-tabs`. Result: 30 passed, 1 skipped (pre-existing skip), exit 0.

Items the driver asked me to verify:
- **Red runs are genuine.** `red-jest-loadSelection.txt` was committed in 3aeebc3fe, which contains the test but no implementation. It shows `Tests: 5 failed, 2 passed, 7 total`. Every failure is a real assertion diff in which the recorded sequence contains the landing default `"A"`. None is a compile error or a zero-test run. `mutation-reducer-ignores-loadTarget.txt` shows the same 5 RED cases failing again. `mutation-guard-landing-default.txt` shows both jest GUARDs failing (`Expected "A", Received "B"`). `red-e2e-direct-load-selection.txt` is a real assertion failure: the own dashboard's id is in recents. Between the red and implementation commits the e2e spec changed only from `expect` to `expect.soft`, which is legitimate.
- **AppShell.tabsHydration.test.tsx change is legitimate.** `:88-90` previously asserted the transient landing default `"a"` while the saved active tab was `"b"`. That is exactly the behaviour HEL-1624 removes. The comment states the reason, which satisfies C4. No other existing test or fixture changed (`git diff --stat` touches only that file among pre-existing tests).
- **The partial-store guard hides no defect.** In `dashboardsSlice.ts:137`, `getState().auth as RootState["auth"] | undefined` only matters for component-test stores that omit the auth slice. In production `auth` is always registered, and D3's reachability argument for `currentUser` holds. If `auth` is absent, the code applies only the deep-link and landing-default rules, which is today's behaviour, so it cannot select a wrong target.
- **Refetch paths.** `useResourceIndexing.ts:76-77` refetches only from `idle`/`failed`, and the reducer returns early when the selection still exists (`dashboardsSlice.ts:511`). A refetch therefore never overrides a navigation-driven selection.
- **`planHydration` stays behaviour-preserving.** Its branches still compute the same tabs and dirty values, and the target now comes from `resolveLoadTarget`, which has the same precedence order. Its no-saved-tabs branch still uses `autoSelectedId` directly, matching `resolveLoadTarget`'s fallback. `loadTarget.ts` imports only `tabTypes.ts`, so there is no cycle.

Non-blocking code notes are under Suggestions.

### Phase 3: UI Review — PASS

I started servers through `start-servers.sh` (lane DB `helio_hel1624`, `ANTHROPIC_API_KEY` empty) and checked with the Playwright MCP browser on port 7056 only. The test user owned three dashboards; the landing default was "Eval Three".
- Deep link to `/dashboards/<Eval One>` at 1440: title "Eval One · Dashboards · Helio". The recents list contains only Eval One. 0 console errors.
- `/dashboards` with saved active tab Eval One (recents cleared first): only Eval One was recorded and the title is correct. 0 console errors.
- Deep link to Eval Two at 768: recents are [Eval Two, Eval One]. The landing default was never recorded and there is no horizontal document overflow. 0 console errors.
- The change is state-only with no layout or CSS diff, so breakpoint risk is nil.

The test user was deleted by exact id through `userCleanupRun.deleteUsersAndFolders`, and the servers were stopped with `stop-servers.sh`.

### Overall: FAIL

### Change Requests
1. **Make the e2e request-log GUARD failable, and record it red (C1).** In `e2e/hel1624-direct-load-selection.spec.ts:87-89`, the `ownRequests` assertion did not fail under its named mutation: `mutation-e2e-gate-and-reducer.txt` contains only the recents error. Do one of the following:
   - (a) Find, with a probe, why the landing dashboard issues no `/api/dashboards/<A>/...` request even with the `tabsHydrated` gate in `App.tsx:174` removed and the reducer reverted. Then name and run a mutation that really does issue one, for example making the App panel-fetch effect dispatch `showDashboardPanels(getMostRecentDashboardId(items))`, or another mutation you can show reaches the request log. Commit that run as a `.txt` in which the `ownRequests` soft assertion appears as an `Error:`.
   - (b) If no realistic mutation can produce such a request, the assertion is vacuous. Relabel it honestly in the spec comment (lines 10-12) and in `tasks.md` 1.2, state what it can and cannot prove, and report that to the orchestrator.

   Either way, the spec comment at lines 10-12 must not claim a mutation that its own evidence shows does not turn it red.
2. **Correct the `DashboardMetaRow.tsx` / `DashboardRefreshLine.tsx` rows of `consumer-audit.md`.** The "Before" cell says "a grantee deep link polled the wrong dashboard's status for a moment". For the tested fixture, where the landing default A is owned, this is false. `DashboardRefreshLine.tsx:82-89` passes `isOwner ? null : selectedDashboardId` to `useSharedDashboardMeta`, so an owned landing default subscribes to no `panel-status` poll. Your own reducer-revert e2e run also recorded no request keyed on A. The claim could be true only when the landing default is itself a shared dashboard (the HEL-1782 viewer-shell user who owns nothing, deep-linking to a second shared dashboard). Reword the row to say this, and mark it inferred unless you measure it.
3. **Tick task 3.3 in `tasks.md`** once the verification is re-run after change request 1, with the run's evidence. The evaluator's run of the same set was green: Playwright 30 passed / 1 skipped, and jest, lint, typecheck and build all exit 0.

### Non-blocking Suggestions
- `dashboardsSlice.ts:512-515`: `action.meta && "loadTarget" in action.meta && action.meta.loadTarget !== undefined` can be `action.meta.loadTarget !== undefined`. `meta` is always present on a fulfilled action, and a missing key reads as `undefined`.
- `dashboardsSlice.ts` was already 585 lines before this change and is now 608, past CONTRIBUTING.md's ~400-line point at which a split should be proposed. Mention a split proposal in the PR description, as CONTRIBUTING.md:24 asks.
- `loadTarget.ts:6` imports `type normalizeSavedTabs` only to derive `SavedTabs` through `ReturnType<typeof ...>`. A named exported type in `tabTypes.ts` would read more plainly. This is optional.
