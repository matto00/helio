## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed tree: HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf. The change dir holds untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/layout-save-unloaded-panel-items/HEL-1527`.
- **Round 4 CR1 (D3 must exclude a failed panel fetch): addressed.**
  - D3's "only when ALL hold" list now includes `status !== "failed"`, and explains that `fetchPanels.rejected` empties `items` but keeps `loadedDashboardId`.
  - I confirmed that claim against the live code: `panelsSlice.ts` L209-213 sets `items = []` and `status = "failed"` and does not touch `loadedDashboardId`. `fetchPanels.pending` (L184-187) sets `loadedDashboardId` and keeps `items`.
  - Task 3.1 mirrors the condition ("status !== failed"). Task 4.4 keeps the "fetchPanels failed (items empty, loadedDashboardId kept)" test.
  - The predicate now excludes every state D3 assigns generic copy: non-400, re-sync failed, stale list, fetch failed, another dashboard, and no unloaded id.
- **Round 4 CR2 ("Rejection caused by an unloaded panel" conditions): addressed.** Its WHEN now reads: "rejected with `400`, the re-sync from the server succeeds, this tab's panel list is loaded for the dashboard and did not fail to load, and the re-synced server layout holds items of panels this tab has not loaded". "No proof" gained "or the panel list failed to load".
- **The two rejection scenarios are mutually exclusive and exhaustive.**
  - "Caused by" = 400 ∧ re-sync ok ∧ loaded ∧ not failed ∧ unloaded id present.
  - "No proof" = ¬400 ∨ not loaded ∨ failed ∨ re-sync failed ∨ no unloaded id.
  - "No proof" is exactly the De Morgan negation of "caused by", so each failure satisfies exactly one of them.
  - "Overlap with a live unloaded panel" carries the same conditions, so it falls inside "caused by" and agrees with it. "Rejected save is visible" (400 → human-readable copy, no raw ids, re-sync) agrees with both.
  - There is one caveat about 409, in Non-blocking note 1.
- **Premises still match the live code.**
  - `layoutPatch.ts` L27 substitutes `resolved[bp]` only. That is the defect D1 fixes.
  - `dashboardsSlice.ts` L211-214 (initial path) and L238-245 (retry path) reject non-conflict failures with `extractErrorMessage(...)`. That is the raw-UUID leak D3 fixes.
  - `showServerLayout` (L196-205) swallows errors and returns void. To implement D3's "re-sync succeeded" condition it has to report success, for example by returning a boolean. That is ordinary implementation work, not a design gap.
  - `DesktopPanelGrid.tsx` L192: `panelsLoaded` = `status === "succeeded"`.
- **Scope and contract.**
  - AC1 is covered by 2.1 and 4.1 (with the red recorded). AC2 is covered by 3.1, 4.3 and 4.4.
  - No new copy: `LAYOUT_CONFLICT_MESSAGE` and "Failed to save dashboard layout." both already ship, so there is no assumed product call.
  - No backend, schema or migration change. The spec delta modifies the one requirement it changes.
- **I1:** D4 leaves `persistedVersionRef`/`baseVersion` untouched. The baseline still follows the response's own `layout` and `layoutVersion`. Task 4.5 has an I1 regression test.
- **No placeholders:** no TODO/TBD found. D5's "reachable or not" branch has a concrete outcome either way.

### Verdict: CONFIRM

### Non-blocking notes

1. **Fix during execution, before archive: a 409 wording collision in the spec delta.**
   - The "Rejection with no proof of an unloaded panel" WHEN says "rejected with a non-`400` status". Read literally, that covers an unresolved 409.
   - `dashboard-layout-concurrency` "Web client resolves a layout conflict" requires the "not saved" conflict copy for that case. The current code (`LAYOUT_CONFLICT_MESSAGE`, dashboardsSlice.ts L225-227 and L240-244) shows that copy, and D3/task 3.1 correctly scope the change to *non-conflict* failures. The design and tasks are therefore right; only the spec sentence over-reaches.
   - Change it to e.g. "rejected with a status other than `400` or `409`" (or "a non-conflict rejection with a non-`400` status"), so the archived main spec does not contradict the concurrency capability.
   - The final gate should check this wording.
2. **Dashboard-switch edge.** During a switch A→B, `fetchPanels.pending` sets `loadedDashboardId = B` while `items` still holds A's panels (status "loading"). A 400 on a B save in that window would satisfy D3 and show "changed elsewhere" rather than the generic copy. A save in that window is unlikely: `panelsLoaded` is false while loading. Either copy is human-readable with no ids, so AC2 holds. Optional hardening: also require `status !== "loading"` only if the executor finds the window reachable. Do not widen scope otherwise.
3. **D3's accepted risk is acknowledged in Risks:** an unrelated 400 with a ghost in the re-synced layout shows "changed elsewhere". This is acceptable because the client never sends a breakpoint that is invalid among its loaded panels.
