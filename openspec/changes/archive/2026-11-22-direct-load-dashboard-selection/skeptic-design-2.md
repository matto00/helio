## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 07a1180016b8032c9c16f2514aa8a8c0319cb776. The change dir is untracked and there are no code changes yet. The spawn-cwd guard returned READY.

### What I verified (with evidence)

- **Round-1 CR1 (spec delta): addressed.**
  - The requirement now lists all five `planHydration` branches in code order: deep link, saved active, stored empty -> null, surviving-none-active -> most recently viewed, else auto-select (`frontend/src/features/dashboards/tabs/hydrateTabs.ts:56-85`).
  - The landing default is restated as first owned, else first listed. This matches `getMostRecentDashboardId` (`dashboardsSlice.ts:63-66`).
  - It has scenarios for none-active and for the grantee deep link.
  - The `MODIFIED` header matches the base `openspec/specs/frontend-dashboard-selection-flow/spec.md`, and both base scenarios are kept (one restated).
  - The "every saved tab pruned away" case falls into branch (5) ("otherwise"), which is correct.
- **CR2 (e2e red first): addressed.**
  - D5 widens the request log to every `/api/dashboards/A/...` request, using a grantee fixture.
  - It labels the request assertion a GUARD if it is green on main, and requires a named mutation.
  - It requires a signal that is red on main. A red signal does exist: `recentVisitsListeners.ts` records a visit for every non-null `selectedDashboardId` transition, so on main the boot auto-selection A is written to recents. That is red for a grantee deep link to S.
- **CR3 (consumer audit): addressed.** D4 now derives `consumer-audit.md` from `grep -rln selectedDashboardId frontend/src` and treats the listed files as the minimum set, not the scope.
  - I checked the riskiest consumer, `useDashboardViewStamp.ts:31-42`. It is match-based (selection === route id), not "skip the first non-null value". Making the target the first selection therefore does not suppress a legitimate stamp.
- **CR4 (cycle-free helper): addressed.**
  - D2 mandates `tabs/loadTarget.ts`, importing only `tabTypes.ts`. `tabTypes.ts` has no import statements (grep found none).
  - The slice's only store import is `import type { RootState }` (`dashboardsSlice.ts:25`), which is type-only, so no runtime cycle is added.
  - Importing from `hydrateTabs.ts` is explicitly forbidden (`hydrateTabs.ts:4` imports from the slice).
- **CR5 (D3 auth resolved): addressed.**
  - D3 states the resolved fact with citations.
  - It requires reading `currentUser` and the pathname after the `await`.
  - It keeps a null-user jest guard, labelled not reachable in production.
- **D1a meta typing is feasible.** In RTK 2.14.0 (`frontend/node_modules/@reduxjs/toolkit/package.json`), `AsyncThunkFulfilledActionCreator` takes meta as an optional 4th argument: `[Returned, string, ThunkArg, GetFulfilledMeta<ThunkApiConfig>?]` (`dist/index.d.ts:993`). So the ~20 direct `fetchDashboards.fulfilled(list, ...)` test dispatches still type-check, and the absent-meta fallback keeps their behaviour.
- **The equivalence holds and hydration stays a no-op.** I re-traced `planHydration` with `autoSelectedId = T`. It returns T in every branch.
  - The navigation-during-hydration re-plan (`hydrateTabs.ts:195-211`) reads the current selection only in the auto-select branch. After a deep link that value is the route id on main too, so it is unchanged.
  - The thunk `condition` (`dashboardsSlice.ts:137-140`) re-runs only after a failure, so stale preferences cannot be applied on a refetch.
- **No other boot-time selection writer.** Every `setSelectedDashboardId(` call site outside tests is a user action, route or hydration path (grep). `/dashboards` renders `PanelList`, which does not auto-select (`AppRoutes.tsx:119`). So "stays null throughout" for a stored empty set is achievable.
- **AC coverage.**
  - AC1 is covered by D5 jest plus the spec's deep-link scenario.
  - AC2 by the no-regression guards and task 3.3.
  - Driver AC red-first plus saved-active by tasks 1.1/1.2.
  - Grantee by the spec scenario and D5.
  - Request log by D5/task 1.2.
  - The consumer list by D4/task 3.2.
  - Frontend only: no backend files in Impact.
  - No scope drift.

### Verdict: CONFIRM

### Non-blocking notes

- Declare `fulfilledMeta` with an optional key (for example `{ loadTarget?: string | null }`). The reducer can then tell "absent" (fallback) from an explicit `null` (stored empty) with `"loadTarget" in action.meta`, without a type cast.
- About 35 component tests render through `App`, which dispatches the real thunk with a mocked service. If any of them asserts the transient landing-default selection before hydration, updating it is legitimate, but call it out with the reason in the executor report. Do not silently adjust it. A fixture change made to pass is a defect symptom.
- tasks.md has an empty "Standing Constraints" heading. Either fill it with the lane constraints that bind tasks 1.x (C12 red-first with mutation, C4 Playwright 2 workers, C14 lane DB), or drop it.
- The requirement title "Most-recent dashboard default selection" no longer describes the behaviour. Keeping it avoids a rename in the base spec, so this is optional.
