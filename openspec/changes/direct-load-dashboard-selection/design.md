## Context

Load path on `main` (07a118001):

1. `App.tsx` dispatches `fetchDashboards()` on mount.
2. `dashboardsSlice` `fetchDashboards.fulfilled`: if the current `selectedDashboardId` is not in the list it becomes `getMostRecentDashboardId(items)`.
3. `DashboardRoute` (on `/dashboards/:id`) dispatches `setSelectedDashboardId(id)` in an effect once the id is known -> at least one render with the most-recent id.
4. `dashboardTabsListeners` starts `hydrateTabs()` once `auth.currentUser` is set and the list succeeded. `hydrateTabs` calls `planHydration({saved, dashboardIds, autoSelectedId: selectedDashboardId, deepLinkId})`; with saved tabs it awaits change signals + a warm restore (bounded 3 s) and only then dispatches `setSelectedDashboardId(plan.target)` and `tabsHydrated`. So the saved-active-tab case holds the most-recent id for up to ~3 s.
5. Panel fetch (`App.tsx`) is gated on `dashboardTabs.hydrated`, and the selection-transition listener is inert until `hydrated`, so the wrong id is mostly cosmetic for those — but `selectedDashboardId` consumers that are not gated (document title, `DashboardRoute`/`PanelList` skeleton, recents listener, the warm/change-dot listeners, the viewer shell for grantees) can see it.

## Goals / Non-Goals

**Goals:**
- `selectedDashboardId` goes straight from `null` to the load target (deep link > saved active tab > stored-empty -> null > surviving-none-active -> most recently viewed tab > landing default) on the first load.
- One rule for "the target": the same precedence `planHydration` uses, not a second copy that can drift.
- No regression in HEL-1575 hydration (deep link, saved active tab, no saved tabs, stored empty set, navigation during hydration) or HEL-1634 sign-out reset.

**Non-Goals:**
- Changing hydration timing, warm restore, change signals or the tab write path.
- Removing the HEL-1575 skeleton-grid key workaround (it stays as defence in depth).
- Refetch behaviour when a selection already exists.

## Decisions

**D1 — Compute the load target in the `fetchDashboards` thunk, apply it in `fulfilled`.** The thunk has `getState` (auth user preferences carry the saved tab set) and the location (`window.location.pathname`, via `deepLinkDashboardId`). After the request resolves it computes the target from the fetched list and carries it as `meta` (D1a); the reducer stays pure. `fulfilled` uses it only when the existing selection is absent from the list (today's condition); otherwise unchanged.
Alternatives rejected: (a) have `DashboardRoute`/`hydrateTabs` select earlier — they run after `fulfilled`, so the wrong value is already committed; (b) select in a listener on `fulfilled` — listeners run after the reducer, same problem; (c) defer the default selection entirely to hydration — would leave the no-auth / pre-hydration case with no selection for consumers that expect one and changes more behaviour.

**D2 — One cycle-free target helper (mandatory).** Create `frontend/src/features/dashboards/tabs/loadTarget.ts`, importing only from `tabTypes.ts` (which has no imports). Move `deepLinkDashboardId` and `mostRecentlyViewed` into it, together with the target-only precedence (deep link > saved active > stored empty -> null > surviving-none-active -> most recently viewed > auto-select). `planHydration` keeps its `dashboardTabsReducer` tabs/dirty computation and calls the helper for the target. `dashboardsSlice.ts` and `hydrateTabs.ts` both import from `loadTarget.ts`; `hydrateTabs.ts` may re-export `deepLinkDashboardId` for existing importers. Importing anything from `hydrateTabs.ts` into the slice is forbidden: `hydrateTabs.ts:4` imports `setSelectedDashboardId` from the slice, so that is a cycle by construction, and the repo has no `import/no-cycle` guard that would flag it. Because the thunk's target equals what `planHydration` later computes with `autoSelectedId = target` (skeptic round 1 traced all five branches), hydration's `setSelectedDashboardId(plan.target)` is a same-value write and its `tabs`/`dirty` are unchanged. The landing default stays `getMostRecentDashboardId` (first owned, else first listed — HEL-1773/HEL-1782 owner ruling 1).

**D1a — Target carried as `meta`.** The thunk returns the list via `fulfillWithValue(list, { loadTarget })`. The `fulfilled` reducer uses `action.meta.loadTarget` when present (including an explicit `null` for the stored-empty case) and falls back to `getMostRecentDashboardId` when the meta key is absent, so the ~20 test files that dispatch `fetchDashboards.fulfilled(Dashboard[], ...)` directly keep working unchanged. Executor confirms RTK's `fulfillWithValue` meta typing works with `createAsyncThunk`'s `fulfilledMeta` generic; if it does not, state the alternative chosen and why.

**D3 — Auth user is always present at fulfilled time in production (resolved).** `AppShell`, which dispatches `fetchDashboards()` (`App.tsx:165-167`), renders only under `ProtectedRoute`, which renders its outlet only when `auth.status === "authenticated"` (`features/auth/ui/ProtectedRoute.tsx:10-25`, `app/AppRoutes.tsx:112-116`); `status` becomes `authenticated` in the same reducer write that sets `currentUser` (`authSlice.ts:211-215, 287-288, 301-302`); a `clearAuth` while the request is in flight bumps the session epoch and `createSessionEpochMiddleware` drops the stale `fulfilled` (`shared/session/sessionEpochMiddleware.ts:36-52`). The thunk SHALL read `getState().auth.currentUser` and `window.location.pathname` AFTER the request's `await`, never before. A null `currentUser` (test-only store) applies only the deep-link and landing-default rules; one jest case covers it, labelled "not reachable in production".

**D4 — Consumers audited from grep, not a fixed list.** `consumer-audit.md` in the change dir is derived from `grep -rln selectedDashboardId frontend/src` (non-test files), one before/after row per file, stating what that file does with the first selection on load. Minimum set that must appear (skeptic round 1): panel fetch gate (`App.tsx`), `document.title` (`App.tsx`), `recentVisitsListeners.ts`, tabs hydration + selection-transition listener, HEL-1783 warm capture / change-dot listeners, HEL-1634 session reset (`clearAuth` root reset + session epoch), HEL-1782 viewer shell, `app/dashboardMeta/DashboardMetaRow.tsx`, `app/dashboardMeta/DashboardRefreshLine.tsx` (`useDashboardMeta`/`useSharedDashboardMeta`/`usePanelStatus`, HEL-1786), `features/dashboards/hooks/useDashboardViewStamp.ts` (HEL-1578: never stamp a boot auto-selection), `features/panels/hooks/usePipelineFedFlagSync.ts`, `DashboardChipRow.tsx`, `useOnboardingHost.ts`, `app/CommandBar.tsx`, `shared/chrome/usePickerSelection.ts`, `PanelList.tsx` and the grid skeleton.

**D5 — Proof.**
- Jest, red first (committed as `.txt` before implementation): a store-level test that subscribes before `fetchDashboards` and records every `selectedDashboardId` value through the full load: fetch -> the `DashboardRoute` effect (simulated by `history.pushState` to the deep link before the fetch plus a `setSelectedDashboardId(id)` dispatch once the id is in the list, or a rendered `DashboardRoute` — state which) -> `hydrateTabs` including its warm wait. Cases and expected result on main:
  - deep link to a non-landing dashboard — RED on main;
  - saved active tab != landing default — RED on main;
  - saved tabs surviving, none active — RED on main;
  - stored empty set (ends null, never the landing default) — RED on main;
  - grantee deep link to a shared dashboard S while the user owns A — RED on main;
  - no saved tabs (expect the landing default: first owned) — no-regression GUARD;
  - null `currentUser` test-only store — GUARD, labelled not reachable in production.
  Assertion: the recorded sequence contains only `null` and the target. Mutation: making the reducer ignore `meta.loadTarget` (revert to `getMostRecentDashboardId`) turns every RED case red again; recorded.
- E2E (Playwright, 2 workers max total): grantee fixture where the user owns A (landing default) and S is shared with them. Fresh load of `/dashboards/S`. Request log over the whole load records every request keyed on a dashboard id; assertion: no `/api/dashboards/A/...` request (panels, panel-status, anything). Because the panel fetch is already gated on `hydrated` on main, that request assertion may be green on main: if so it is labelled a GUARD, with the mutation that turns it red named and run (e.g. removing the `tabsHydrated` gate in `App.tsx`). The spec SHALL also carry a signal that is RED on main, e.g. an in-page selection recorder (store subscription exposed on `window` in dev/test builds only if such a hook already exists; otherwise a sampled `document.title` via a `MutationObserver` on `<title>` installed by `addInitScript`, or the recents entry for A recorded by `recentVisitsListeners.ts`). Executor picks one, proves it red on main, and commits that red run as `.txt`.
- No-regression: existing HEL-1575 hydration jest tests and tab e2e specs green.

## Risks / Trade-offs

- [Module cycle between slice and tabs helper] -> D2's mandatory cycle-free `loadTarget.ts`.
- [`window.location` read inside a thunk is impure] -> already the pattern in `hydrateTabs` (`deepLinkDashboardId(window.location.pathname)`); the reducer itself stays pure.
- [Refetch callers (`useResourceIndexing`, onboarding) re-run the thunk] -> the target is only applied when the existing selection is absent, same as today, so a later navigation-driven selection is never overridden.
- [Stored-empty set now yields `null` immediately rather than most-recent then null] -> final state identical; consumers that relied on a transient non-null (none expected) are covered by D4.
