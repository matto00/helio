## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf. The change dir is untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/layout-save-unloaded-panel-items/HEL-1527`.
- **Round 3 CR1 (narrow the first sentence): addressed.** The spec delta now reads "...and is invalid among the panels this tab has loaded". It also adds "Items of panels this tab has not loaded are not judged by the client: they are sent as authored and the server is the authority on their validity." That matches design D2.
- **Round 3 CR2 (overlap scenario conditions): addressed.** The WHEN of "Overlap with a live unloaded panel is rejected visibly" now includes "the re-sync from the server succeeds, and this tab's panel list is loaded for the dashboard".
- **Round 3 non-blocking notes:**
  - D3's spliced sentence is tidied.
  - Task 2.1 adds blank-id and duplicate skipping "like `liveEntries`" (dashboardLayout.ts L108).
  - D3 says to read `getState()` after the re-sync.
  - Task 4.2 now cites `DashboardLayoutGhostWriteSpec` L63 for server acceptance.
- **Live code still matches the design's premises:**
  - `layoutPatch.ts` `buildLayoutPatch` substitutes `resolved[bp]` only (L27).
  - `dashboardsSlice.ts` L196-205: `showServerLayout` swallows errors. L217-218: the non-conflict path rejects with `extractErrorMessage`. L240-246: the retry path does the same.
  - `panelsSlice.ts` L184-188: `fetchPanels.pending` sets `loadedDashboardId` and keeps `items`.
- **New defect found while checking the D3 predicate against `panelsSlice.ts`:** `fetchPanels.rejected` (panelsSlice.ts L206-210) sets `items = []` and `status = "failed"` but leaves `loadedDashboardId` unchanged. D3's conflict copy applies "only when ALL hold":
  - the failure is a 400,
  - the re-sync succeeded,
  - `loadedDashboardId === dashboardId`,
  - and the re-synced layout holds an id absent from `items`.

  All four hold in the fetchPanels-failed state, because every id is absent from an empty `items`. Yet the next sentence of D3, and task 4.4, require generic copy in that state. A predicate implemented literally from D3 fails D3's own required test.
- **Spec scenario precedence, the same class as round 3 CR2, in a sibling scenario:** "Rejection caused by an unloaded panel" has WHEN = "rejected with `400` and the re-synced server layout holds items of panels this tab has not loaded" and THEN = conflict copy. It has no condition that the panel list is loaded for the dashboard. "Rejection with no proof of an unloaded panel" says that "this tab's panel list is not loaded for the dashboard" → generic copy.
  - With a stale list (`loadedDashboardId` null), the tab has loaded no panels for the dashboard. Every re-synced item is then "of a panel this tab has not loaded", so both scenarios apply with contradictory THENs.
  - The same overlap exists for fetchPanels-failed.
  - Round 3 refuted exactly this contradiction on the "Overlap…" scenario; the fix was applied there but not to this sibling.
- **Scope:** AC1 is covered by tasks 2.1/4.1, and AC2 by 3.1/4.3/4.4. No new copy (both strings already ship). No backend, schema or migration change. I1 is untouched (D4; no version-ref change).

### Verdict: REFUTE

### Change Requests

1. **design.md D3, the "only when ALL hold" list:** add a condition that the panel list actually loaded for this dashboard, not merely that it was requested. For example, "`loadedDashboardId === dashboardId` and panels `status !== "failed"`" (`fetchPanels.rejected` keeps `loadedDashboardId` and empties `items`, panelsSlice.ts L206-210). The listed conditions must then exclude every state D3 assigns generic copy. Mirror the condition in task 3.1 or 4.4 so the fetchPanels-failed test asserts it.
2. **specs/dashboard-layout-validation/spec.md, scenario "Rejection caused by an unloaded panel":** add to its WHEN the same conditions as the "Overlap…" scenario: "the re-sync succeeds and this tab's panel list is loaded for the dashboard". Optionally, extend "Rejection with no proof of an unloaded panel" with "or the panel list failed to load". It must no longer overlap the "no proof" scenario for a stale or failed panel list.

Both are small wording and predicate fixes. The architecture (D1/D2/D4/D5) is sound and needs no change.

### Non-blocking notes

- Task 4.4 already lists "fetchPanels failed" as its own test. That test would have caught CR1 at execution time, but the archived design should not state a predicate that contradicts it.
