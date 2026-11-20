## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: `febb2013bd8b41704084192749535c3c4249576f` (branch `bug/shared-dashboard-change-dots-warm/HEL-1783`,
change dir untracked). The artifacts were judged on their own merits. Every code claim below was checked against the
file it names.

### What I verified (with evidence)

**Backend D1, `DashboardChangesRepository.scala`**
- Today both queries run in a single `withUserContext` (`contentQuery(ids).zip(dataQuery(ids))`). `dataQuery` inner-joins
  `outputs`, so RLS on `outputs` drops every panel of a dashboard-only grantee. The Why is accurate.
- `panels.kind` exists (`V94__outputs_model.sql:343`). `p.kind = 'output'` is a valid filter.
- Using `withSystemContext` after the ACL has precedent in this repo. `DbContext.scala:62` requires an inline
  justification, and D1 commits to one.
- Disclosure holds. Data is read only for the ids `contentQuery` returned under RLS, and items are built from the
  content map. `SharedDashboardPanelsSeamSpec` shows a viewer's panel list carries the output panel's config, and D5
  asserts the subset relation directly.
- The m2 mutation (raw ids AND items built from the data rows) is a genuine double fault. It goes red on the
  stranger-omission case.

**Warm cache, memory path (DA → DB → DA)**
- `showDashboardPanels.ts:84-89` excludes non-owned dashboards today. D3 replaces that with a scope match.
- `restoreFromMemory` gates on `isContentValid` (the grantee already gets `contentUpdatedAt`) and on `isWindowFresh`
  against `signal.outputs` (populated once D1 lands). It currently calls `unscopeOutput` for every bound Output
  (`showDashboardPanels.ts:62`). D3 replaces that with the shared `applyPanelReadScopes` call, made before
  `panelsRestored`.
- `captureTab` (`warmCapture.ts:107`) skips non-owned dashboards, and it needs a prior list entry. That entry comes
  from `recordFetchResult` (`warmListeners.ts:156`), which fires for every `fetchPanels`. D2 removes the skip and adds
  `readScope`.
- The card gate is `usePanelData.ts:308` `isReusable`, and `usePanelSortFilter.ts:303` uses the same function.
  `isReusable` (`panelRowsReuse.ts:52-59`) requires `getOutputMetaCached(outputId)?.pipelineId` and `hasRunBaseline`.
  A scoped stub has `pipelineId: ""` (`outputMetaCache.ts` `outputFromPublicMeta`), so without D3b every restored
  shared card re-reads. D3b handles this.
- Retention: `retainTab` on capture, then `releaseTab` on restore. The 30 s grace (`outputFreshness.ts:87-92`) covers
  the gap until the card's `useOutputRetention` mounts. Generation: a scoped Output registers no pipeline, so run
  fan-out never bumps it while the user is away. Only `invalidateOutput` from a stale `isWindowFresh` bumps it,
  which is the intended path.
- The re-read path is correct. `fetchPanelPage` routes by `panelReadScopeFor` (the dashboard role,
  `panelThunks.ts:401`), not by the meta-cache scope. A stale window on a shared dashboard therefore re-reads through
  the per-panel route.

**Warm cache, stored and reload path**
- `sanitizeEntry` rebuilds the entry from a fixed field list (`warmStore.ts:66-87`), so `readScope` would be stripped.
  D2 adds it to `WarmEntry`, `WARM_ENTRY_KEYS` and `sanitizeEntry`, and m7 proves it.
- `applyWarmEntry` (`warmRestore.ts`) seeds `seedOutputMeta` and `seedObservedRun` unconditionally. D3 moves the scope
  check inside it, so both callers are covered: `showDashboardPanels` and `hydrateTabs.boundedRestore`
  (`hydrateTabs.ts:111`). It also forbids meta and baseline seeding for `panel` entries.
- `hydrateTabs` is dispatched only after `dashboards.status === "succeeded"` (`dashboardTabsListeners.ts:45`), so the
  role is known at restore. This confirms the D3 claim.
- After `applyWarmEntry`, `restoreFromMemory` runs (`showDashboardPanels.ts:110`), so the scope application and seeding
  in D3/D4 run on the stored path too. The windows are restamped with `currentGeneration`, and `retainTab` is called.
  The scoped card then reuses them under D3b.
- Conclusion: AC2's warm half is achievable through every restore gate (memory, lazy stored, hydrate stored), and
  m3/m4/m6/m7/m8 each hit a distinct gate.

**D4, `panelStatusStore.ts`**
- The first snapshot is a pure baseline (`advancedPanels`: `previous === null` → `[]`).
- An advance with no listener is dropped today (the `advanceListeners.get(panelId) ?? []` loop).
- The entry is deleted on the last release (`release`).
- These three facts confirm the gap D4 closes, and the need for (b) and (c).

**Plan hygiene**
- tasks.md 4.2 now lists m1-m8, which matches D5.
- `recordFetchResult` is named in D2. The dashboard-id-keyed seed map is stated in D4(c). The 30 s visibility gap is
  stated in the e2e. The ticket ACs and the owner ruling are each covered by a task.
- I found no placeholders or contradictions between the proposal, design, tasks and specs.

**The one hole: D3b's safety argument is false for a route-level remount**
- D3b says that on an ACTIVE shared dashboard a remount reuses its window, and that "freshness there comes from the
  `panel-status` poll". That holds only while a `panel-status` consumer stays mounted.
- `DashboardMetaRow` renders only when `usesDashboardMetaRow(location.pathname, …)` (`App.tsx:245`), and every other
  consumer is a card (`PanelCard.tsx:152`, `PanelCardBody.tsx:219`).
- Leaving the dashboard view for another route (`/home`, `/settings`, `/chat`; `AppRoutes.tsx:117-128`) unmounts all
  of them. `release` then deletes the entry and its snapshot.
- Coming back to `/dashboards` does not re-run `showDashboardPanels`. The `App.tsx:173-179` effect keys on
  `selectedDashboardId`, which did not change, and `loadedDashboardId` is still DA. So no restore runs and no D4 seed
  is placed.
- The cards remount within the 30 s grace, and under D3b `isReusable` is true, so they keep the old window. The new
  entry's first snapshot is a pure baseline taken at the NEW `dataUpdatedAt`, so no advance ever fires.
- Result: a run that finishes during a sub-30 s visit to another route leaves the shared panel showing stale rows until
  the next run. Today the same remount re-reads (no run baseline means not reusable), so D3b introduces this
  regression. None of D5's tests or mutations covers this path.

### Verdict: REFUTE

D1, D2, D3 and D4 are sound, and the warm restore is achievable end to end, memory and stored. But D3b loosens row reuse
for every panel-scoped remount, not just restores. Its stated safety net, the `panel-status` poll, is torn down on a
route change. A remount that goes through no restore therefore has neither a seed nor a live snapshot, and it serves
stale rows indefinitely. That is a correctness regression this change introduces, and it is a design decision, so it
belongs in the artifacts.

### Change Requests

1. **D3b/D4: tie panel-scoped reuse to an in-force status baseline.** Files: `panelRowsReuse.ts:52-59`,
   `usePanelData.ts:308`, `usePanelSortFilter.ts:303`, `panelStatusStore.ts`. Pick one of these and state it:
   - (a) Seed at reuse, not only at restore. Whenever a card reuses a panel-scoped window, it calls
     `seedPanelStatusBaseline(dashboardId, {[panelId]: window.capturedAt})`. Extend D4's semantics for the case where
     the entry already holds a snapshot: compare that snapshot's `dataUpdatedAt` against the seed immediately, and
     queue an advance if it is strictly later, delivered under D4(b). The restore-time seed can then be dropped or
     kept; say which.
   - (b) Narrow D3b. A panel-scoped window is reusable only if a panel restore kept and seeded it, for example by a
     marker set by the restore and consumed on that mount. Every other panel-scoped remount re-reads, exactly as
     today. Then restate D3b's "effect on an ACTIVE shared dashboard" paragraph to match.

   Also add:
   - A jest case (card level or `usePanelData` level) for the route-level remount: a mounted shared card, then all
     `panel-status` consumers unmount, then the status reports a newer `dataUpdatedAt`, then a remount within
     `REMOUNT_GRACE_MS`. That panel's rows must be re-read through the per-panel route, either on mount or on the
     first status snapshot.
   - A mutation (m9) that removes the chosen guard. That jest case must go red.

   Also list the case in the `dashboard-grantee-access` spec delta: a shared panel remounted after its status polling
   stopped still refreshes when its data advanced.

### Non-blocking notes
- D4 says the seed is "called by a `panel` restore". On the stored path that is the `restoreFromMemory` call that
  follows `applyWarmEntry`, not `applyWarmEntry` itself. Name the single call site (`restoreFromMemory` covers memory,
  lazy stored and hydrate) so the executor does not seed twice or zero times.
- On the lazy stored path, `DashboardMetaRow`'s first `panel-status` read can resolve during the up-to-500 ms
  `readStoredEntry` wait, before the seed exists. D4(a) then applies the seed to the NEXT poll, up to 15 s later. That
  is correct but slower. If e2e (d) ever asserts a refresh after a reload, allow for that interval.
- `panelScopes` is keyed by Output id across dashboards. A user who owns a dashboard and is a grantee on another, with
  both bound to the same Output, flips the scope on each `fetchPanels` or restore. This predates the change (HEL-1773).
  Under D3b, though, the scope now also decides reuse. The dual-grant backend case in D5 is the place to add one jest
  assertion that the owned dashboard's restore leaves `isReusable` on the owner branch.
