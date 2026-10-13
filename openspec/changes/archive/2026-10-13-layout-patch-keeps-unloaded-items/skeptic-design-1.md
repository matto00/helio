## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf (origin/main tip; the change dir is untracked planning artifacts only).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/layout-save-unloaded-panel-items/HEL-1527`.
- **Design context matches the code.**
  - `layoutPatch.ts` `buildLayoutPatch` is as described: it sends `resolved[bp]` for a changed and invalid bp.
  - `resolveDashboardLayout` (`dashboardLayout.ts` ~L139) filters saved entries to live ids (`liveEntries`, L108-114) and returns `panels.map(...)`. Unloaded panels' items are therefore absent from `resolved`.
  - `DesktopPanelGrid.tsx` L344-348 is the HEL-1457 `kept` rule.
  - `updateDashboardLayout` (`dashboardsSlice.ts` L215-246) passes `extractErrorMessage(err, …)` through on both non-409 paths.
  - `toastListeners.ts` L170 shows the payload.
  - D1 (kept items from `next[bp]`, loaded ids from `resolved[bp]`) is sound and mirrors DesktopPanelGrid.
- **D2 coherence: does not hold for a non-empty patch.** Traced through the live code:
  - `persistLayout` passes `sentLayout: nextLayout`, the full authored layout including the omitted bp's edit (`useLayoutSave.ts` L264-269).
  - The fulfilled reducer (`dashboardsSlice.ts` L422-436) adopts the server response whenever the store layout equals `sentLayout`, and sets `hasPendingLayout = false`. With no edit during the round trip, the two are equal.
  - The response carries the server's UNCHANGED stored version of the omitted bp. So the store's authored layout is overwritten, and the user's edit in that bp is reverted on screen.
  - In the hook's `.then` (L281-300): `adopted` is true, the baseline becomes the response, and `pending = latest != response`, which is false.
  - Net effect: the omitted edit is **silently discarded**, with no toast and no pending flag. This contradicts D2's claim "the authored layout stays different from the baseline, so pending stays set and the next flush retries". It also contradicts the requirement title "…never fails silently".
  - Reachability: a pending layout can span several breakpoints. Examples are a drag in `lg`, then a resize, then a drag in `md` before the 30 s flush; or an undo/redo traversal that changes several breakpoints. If one of those breakpoints is omitted and another is sent, the patch is non-empty.
- **D2 empty patch:** today `buildLayoutPatch` returns `{}` only when next equals the baseline, which `persistLayout` L244 already guards. So an empty patch is new, and the planned guard (task 2.3) is needed. When the guard skips, pending stays true and `inFlightLayoutRef` stays untouched (fine). But "Save now" and the unmount flush then do nothing visible. See CR2.
- **I1 (D4):** neither change touches `persistedVersionRef`. The baseline and version still pair from one response. An omitted bp is unchanged on the server, so an authored bp derived from it under the response version does not violate I1. I1 holds under either fix in CR1.
- **D3 detection:**
  - During the refetch gap (the ticket's part-2 state), `fetchPanels.pending` sets `loadedDashboardId = dashboardId` and keeps the old `items` (`panelsSlice.ts` L184-188). The `loadedDashboardId === dashboardId` + `items` predicate therefore works there.
  - It is undefined in two other states:
    - after `markDashboardPanelsStale` (L174-176: `loadedDashboardId = null`) but before the fetch is dispatched;
    - after `fetchPanels.rejected` (`items = []`, so every panel reads as "unloaded").
  - The design does not say which copy applies in those states. See CR3.
- **D3 honesty:** `LAYOUT_CONFLICT_MESSAGE` ("…changed elsewhere; your last layout change was not saved.") is honest for the ticket's case: another writer placed a panel this tab has not loaded, and the change was not saved. The generic "Failed to save dashboard layout." already ships as the toast fallback (`toastListeners.ts` L170) and as the thunk fallback. Choosing between two shipped strings is sound, not a dodge: no new wording is introduced, and DESIGN.md's "human-readable" bar is met. Leaving the server's 400 text unchanged is right for the agent/MCP consumers.
- **Spec fidelity:** the HEL-1071 requirement (`openspec/specs/dashboard-layout-validation/spec.md` L60-74) is kept verbatim:
  - The first two sentences and the create-panel sentence are unchanged, and both original scenarios are kept.
  - Only "Rejected save is visible" is changed, from "server's message" to client copy, as ticket part 2 directs.
  - Additions are additive.
  - One internal gap remains: see CR4.
- **Scope:** both ACs are covered (tasks 2.1/4.1 for AC1, 3.1/4.3/4.4 for AC2). D5 reachability is handled without inventing a live repro, as the ticket asks. No backend, schema or migration change.

### Verdict: REFUTE

### Change Requests

1. **D2 / tasks 2.2, 4.5: specify what happens to the save when ANY changed breakpoint is omitted but others are sent.** As planned, the response is adopted and the omitted bp's authored edit is reverted silently (reducer `dashboardsSlice.ts` L428-433 plus hook `useLayoutSave.ts` L291-300). Pick one of these and state it in design.md:
   - (a) If any changed bp would be omitted, send nothing (treat it like the empty-patch case).
   - (b) Send the partial patch with a `sentLayout` whose omitted breakpoints are the baseline's. The reducer then keeps the local layout by reference, the hook re-baselines to the response, and pending stays true.

   Add a test: a two-breakpoint pending change with one bp still invalid after the combination. After the response, the store must still hold the authored edit for the omitted bp, and `hasPendingLayout` must be true. The I1 assertion must show the version refs follow only the response.
2. **D2 "never fails silently": say how an omitted edit stops being unsaved.**
   - The design assumes "the next flush (after panels load…) retries". Nothing in the plan triggers a panel load. `refetchPanelsIfLayoutNamesUnknown` runs only on a re-baseline or an adopted response, and neither happens on a skipped or omitted save.
   - A kept item can be a ghost: a panel deleted elsewhere that will never load. In that case the combination may stay invalid forever, Save now is a silent no-op, and the unmount flush loses the edit.
   - Required: on omission, call `refetchPanelsIfLayoutNamesUnknown(nextLayout)` (or equivalent), or surface one of the two existing strings. State which in the design. Either way, update the risk entry "toast not shown since nothing failed" so it does not contradict the requirement's "never fails silently".
3. **D3: define the "unloaded panel" predicate when the panel list is not loaded for this dashboard.** This covers `loadedDashboardId !== dashboardId` (stale and not yet refetching) and `status === "failed"` (`items = []`). State which copy each state gets, add one slice test for it, and list it in task 4.3/4.4.
4. **Spec delta: the scenario "Substitution keeps an unloaded panel's item" must carry its precondition.** As written, its THEN ("the breakpoint sent is … plus that panel's authored item") contradicts the next scenario whenever the combination is invalid. Add "and that combination is valid" to the WHEN. If CR1 picks option (a), also reword "Still-invalid substitution is not sent" to cover the other breakpoints.

### Non-blocking notes

- D3 says "after the re-sync". `showServerLayout` dispatches `dashboardUpserted` synchronously, but `useLayoutSave`'s re-baseline effect, and the `markDashboardPanelsStale` it can trigger, run after React commits. The thunk's `getState()` read therefore still sees the pre-refetch panel list, which is what D3 needs. Add a one-line comment saying the read must happen before any await that could let React flush.
- Task 3.2: the existing tests that assert the server message reaches the toast need to be inverted (asserting no UUID), not just deleted.
