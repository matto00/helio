## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 07a1180016b8032c9c16f2514aa8a8c0319cb776 (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Load path claims (Context 1-5): accurate.**
  - `fetchDashboards.fulfilled` picks `getMostRecentDashboardId` when the selection is absent (`frontend/src/features/dashboards/state/dashboardsSlice.ts:478-494`).
  - `DashboardRoute` selects the routed id in an effect, only once it is known (`features/dashboards/ui/DashboardRoute.tsx:31-33`).
  - The hydration trigger needs `currentUser !== null` and status `succeeded` (`tabs/dashboardTabsListeners.ts:43-55`). `hydrateTabs` dispatches `setSelectedDashboardId(plan.target)` only after the bounded warm wait (`tabs/hydrateTabs.ts:161-216`).
  - The panel fetch is gated on `dashboardTabs.hydrated` (`app/App.tsx:171-179`). The selection-transition listener is inert until hydrated (`dashboardTabsListeners.ts:58-60`).
- **D1 (target computed in the thunk): sound, and it removes the transient in every load case.** I traced `planHydration` with `autoSelectedId = T`, where T is the thunk's target computed from the same list, location and preferences. It returns T in all five branches: deep link, saved active, stored empty -> null, surviving-but-none-active -> most recently viewed, and else -> autoSelected. Its `tabs` and `dirty` are the same as today's, so the later hydration write is a same-value write. Two things outside this fix:
  - A navigation made during hydration re-plans (`hydrateTabs.ts:194-209`). That is a selection the user caused.
  - A deep link to a dashboard that is not in the list falls through to the saved tab or the landing default. That is today's behaviour; `DashboardRoute` shows "not found".
  - Refetch is not a stale-preferences risk. The thunk `condition` skips `loading` and `succeeded` (`dashboardsSlice.ts:137-140`), so it only re-runs after a failure, which is before hydration. The root reducer resets the slice on `clearAuth` (`store/store.ts:94-100`).
  - Shared dashboards are in the list (`PanelList.tsx:62`), so the grantee deep link is covered by the same rule.
- **D3 (auth user absent at fulfilled time): it cannot be absent.** The design left this as a two-branch conditional, but the code settles it:
  - `AppShell`, which dispatches `fetchDashboards()` at `App.tsx:165-167`, renders only under `ProtectedRoute`. `ProtectedRoute` renders the outlet only when `auth.status` is `authenticated` (`features/auth/ui/ProtectedRoute.tsx:10-25`; `app/AppRoutes.tsx:112-116`).
  - `status` becomes `authenticated` in the same reducer write that sets `currentUser` (`authSlice.ts:211-215`, `287-288`, `301-302`).
  - A `clearAuth` while the request is in flight bumps the session epoch. `createSessionEpochMiddleware` then drops the stale `fulfilled` before any reducer sees it (`shared/session/sessionEpochMiddleware.ts:36-52`).
  - So, read after the `await`, `getState().auth.currentUser` is non-null in production.
- **D2 (module-cycle risk): a real cycle.** `hydrateTabs.ts:4` imports `setSelectedDashboardId` from `dashboardsSlice`, so importing anything from `hydrateTabs.ts` into the slice is a cycle by construction. Its transitive imports (warm cache/restore, `dashboardTabsSlice` -> `authSlice`) widen it. There is no cycle guard: no `import/no-cycle` or madge in the eslint config, `package.json`, `CONTRIBUTING.md` or `MISTAKES.md`. `tabs/tabTypes.ts` has no imports at all, so a helper that depends only on it is cycle-free.
- **Spec delta vs base:** the `MODIFIED` header matches `openspec/specs/frontend-dashboard-selection-flow/spec.md:6` exactly.
- **Consumers:** 26 non-test files read `selectedDashboardId` (grep, listed in CR3).

### Verdict: REFUTE

### Change Requests

1. **The spec delta contradicts D2 and the code.** Fix `specs/frontend-dashboard-selection-flow/spec.md`:
   - (a) The requirement text leaves out the precedence branch D2 says "must also apply": saved tabs survive but none is active -> the most recently viewed surviving tab (`hydrateTabs.ts:70-73`). As written, the spec allows "first item" and then a switch at hydration. Add the branch in `planHydration`'s order, with a scenario for it.
   - (b) The fallback is not "the first dashboard in the response". `getMostRecentDashboardId` lands on the first OWNED dashboard, and on the first listed item only when the user owns none (HEL-1782 owner ruling 1, `dashboardsSlice.ts:60-66`). Restate the fallback to match, and change D5's "no saved tabs (expect most recent)" expectation to the owned-first landing.
   - (c) Add the grantee scenario from the driver AC: a grantee deep link where the landing default is a different dashboard.
2. **The e2e red-first task contradicts the design's own Context.** Context 5 and `App.tsx:171-179` gate the panel fetch on `hydrated`, and hydration selects the target before it sets `hydrated`. So on main there is already no `GET /api/dashboards/<A>/panels`, and task 1.2's "record its red run" cannot be met by that assertion. Revise D5/task 1.2 to do both of these:
   - (a) Widen the request log to every request keyed on the wrong dashboard: any `/api/dashboards/<A>/...`, including `panel-status`, which `DashboardMetaRow`/`DashboardRefreshLine` -> `useSharedDashboardMeta` -> `usePanelStatus` subscribes for a non-owned selected dashboard (HEL-1786). Use a grantee fixture where A is shared, not owned.
   - (b) Name a signal that is red on main. Examples: the recents entry recorded for A by `recentVisitsListeners.ts:30-49`, a sampled `document.title`, or an in-page selection recorder. If a signal cannot be made red, label it a guard and state the mutation that turns it red (lane constraint C12).
3. **D4's consumer list is fixed and incomplete.** It names the ticket's seven areas. Grep finds unguarded first-selection consumers it omits:
   - `app/dashboardMeta/DashboardMetaRow.tsx` and `app/dashboardMeta/DashboardRefreshLine.tsx`: `useDashboardMeta` and `useSharedDashboardMeta` for the selected id.
   - `features/dashboards/hooks/useDashboardViewStamp.ts`: its HEL-1578 contract is "never a dashboard auto-selected at boot".
   - `features/panels/hooks/usePipelineFedFlagSync.ts`: it dispatches `dashboardPipelineFedObserved` for the selected id.
   - `features/dashboards/ui/DashboardChipRow.tsx`, `features/onboarding/hooks/useOnboardingHost.ts`, `app/CommandBar.tsx`, `shared/chrome/usePickerSelection.ts`, `features/panels/ui/PanelList.tsx` and the grid skeleton.

   Require `consumer-audit.md` to be derived from `grep -rln selectedDashboardId frontend/src` (non-test), with one before/after row per file. The fixed list should be the minimum, not the scope.
4. **Make D2's cycle-free module mandatory, not conditional.** "If it would [break store construction]" invites importing from `hydrateTabs.ts`, which creates a real cycle that nothing in the repo would flag. Specify:
   - Create `features/dashboards/tabs/loadTarget.ts`, importing only from `tabTypes.ts`.
   - Move `deepLinkDashboardId` and `mostRecentlyViewed` into it, along with the target-only precedence. `planHydration` keeps the `dashboardTabsReducer` tabs computation and calls the helper for the target.
   - `dashboardsSlice.ts` and `hydrateTabs.ts` both import from it; `hydrateTabs.ts` may re-export `deepLinkDashboardId` for existing importers.
5. **Replace D3's conditional with the resolved fact** above (ProtectedRoute + atomic `status`/`currentUser` + epoch middleware, with the citations). Require the thunk to read `auth.currentUser` and `window.location.pathname` after the request's `await`, not before. Keep one jest case for a null `currentUser` (a test-only store), where the deep link -> landing default rules apply, and label it as not reachable in production.

### Non-blocking notes

- Payload vs `meta` (D1): about 20 test files dispatch `fetchDashboards.fulfilled(Dashboard[], ...)` directly. Carrying the target as `meta` (via `fulfillWithValue`), with an absent-meta fallback to `getMostRecentDashboardId`, keeps those fixtures and the recents test ("arrives via fetchDashboards.fulfilled with no prior selection") unchanged. Changing the payload shape churns them all. Worth stating the choice in design.md.
- D5's "store-level test ... DashboardRoute effect": say how the route effect is simulated (for example `history.pushState` plus a `setSelectedDashboardId(id)` dispatch once the id is known, or a rendered `DashboardRoute`). Also say which cases are expected red on main: deep link, saved active, none-active and stored empty. "No saved tabs" and the null-user case are no-regression guards.
- Keep the HEL-1575 skeleton-grid key, as the Non-Goals already say.
