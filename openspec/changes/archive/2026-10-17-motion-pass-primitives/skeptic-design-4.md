## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: c8e204e065a817babc5ef5a74df8878bb4af73c0. The only difference from main is the untracked change directory.
Scope: items 1-5 and 7. I treat D12 (items 6 and 8) as pending, not as a decided scope cut.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/motion-pass-primitives/HEL-1584`.
- **`openspec validate motion-pass-primitives --strict`** returned "Change 'motion-pass-primitives' is valid". A grep for TODO/TBD across the proposal, design, tasks and both spec deltas found nothing.

#### Round-3 CR1 (a refetch while mounted re-arms the replay): fixed

- **D4.** The registry is `Map<scope, Set<token>>`. The initializer is `!registry.get(scope)?.has(token)`, which is pure. An effect keyed on `[scope, token]` records every token seen while mounted. D4 lists the edit paths and gives the three tests: refetch while mounted, then remount, plays nothing; a load that arrived while no grid was mounted plays; a restored load never plays.
- **specs/motion-primitives.** "First mount per token" now says every token observed while mounted counts as seen. It adds the scenario "Token changes while mounted".
- **specs/surface-motion.** "Returning to an already-loaded dashboard" now says "no load ... since the user last saw that dashboard's grid (including a refetch ... while the grid was on screen)".
- **Tasks.** Task 3.2 has "every token seen while mounted recorded". Task 3.3 has "refetch while mounted → unmount → remount: no replay", and its "new `loadId`" test is narrowed to a load that arrived while no grid was mounted. Task 6.3 and D14 both carry "add a panel → Home → back: no entrance".

**Checked against the code: the grid really does stay mounted during these refetches.**
- `markDashboardPanelsStale` (`panelsSlice.ts:214-223`) does not clear `items`. It sets `staleDashboardId` to the selected id, so the idle arm of `showPanelGridSkeleton` (`PanelList.tsx:121-126`) is false.
- `fetchPanels.pending` (:224-243) does not clear `items` either, so `panelsMatchDashboard` stays true and the loading arm is false too.
- `PanelGrid` (`PanelList.tsx:421-433`) therefore stays mounted, and its `[scope, token]` effect sees `dash:K+1`.
- This holds for `createPanel` (`panelThunks.ts:114`), `swapPanelOutput` (:150), `duplicatePanel` (:183) and `useLayoutSave.ts:174`.
- `deletePanel` (:166) marks the list stale without a fetch. Deleting the last panel unmounts the grid. Adding a panel after that mounts a fresh grid with one panel, which is the "fresh mount with one panel: `enter`" case D4 now names.

**Other mechanism checks**
- **StrictMode.** The initializer is evaluated twice, both times before any effect, so the two calls agree. The simulated effect remount keeps state, so the latched value is stable.
- **No new commit.** The token adds no state and no commit, so D13's "+1 commit" budget is unchanged.
- **Token reuse.** `loadId` only increases. A restored mount records `B:<loadId of another dashboard's load>`, and no later network load of B can carry that id.
- **Logout.** There is no store reset on logout (`store/store.ts` has no reset), so tokens stay unique across a logout too.
- **Warm restore.** `showDashboardPanels.ts` returns after `panelsRestored` with no follow-up `fetchPanels`, so a restore never also bumps `loadId`.
- **D5.** The grid Crossfade does not use `keepContentMounted`. The keyed `PanelGrid` still unmounts while loading, so it never mounts early and latches against stale data.

#### Round-3 non-blocking notes: all addressed

- The `registry.get(scope)?.has(token)` wording is fixed.
- The empty-first test is written as a fresh mount with one panel.
- D14 lists the Home round trip and the add-panel round trip.

#### Driver invariants

- `key={selectedDashboardId}` on `PanelGrid` and the skeleton's dashboard-id key stay.
- No new input reaches layouts, breakpoint, cols, width, compactor, handlers or child keys. The token changes only a latched boolean and `data-entrance` attributes.
- Earlier sign-off of the D4/D8 PanelGrid/DesktopPanelGrid touch stands. It remains conditional on round-1 CR2 and on the D13 before/after numbers in the PR.

### Verdict: CONFIRM

The round-3 hole is closed in the design, both spec deltas and the tasks, and the closure holds against the reducers and `PanelList` gating in the tree. I found no new blocking defect.

### Non-blocking notes

- **The patch-set apply is not a mounted-grid refetch.**
  - D4 lists "the patch-set apply in `patchSetsSlice.ts`" among the refetches that happen while the grid stays on screen. The apply happens on `PatchSetReviewPage`, which is its own route (`AppRoutes.tsx:145`). It runs `markDashboardPanelsStale` and then a `fetchPanels` that is not awaited (`patchSetsSlice.ts:235-236`), and then navigates to `/dashboards` (`PatchSetReviewPage.tsx:143`).
  - So after an apply the result depends on timing:
    - If the fetch lands before `PanelList` mounts, the whole grid staggers. The token is unseen, which is correct per the spec: a new load since the user last saw the grid.
    - If it lands after, the old token is already seen, the latch is false, and only the new panels pop.
  - Both outcomes match the spec, but D4's list should drop the apply or say this. D12's rationale ("`later: "pop"` already animates any panel added to a mounted grid, including by apply") should say the apply case is timing-dependent: new panels pop, or the whole grid re-staggers. That way the owner's item-6 ruling rests on an accurate premise.
  - The undo path from the toast does run on the mounted grid. It is recorded and pops.
- The same race applies to "add a panel, then leave for Home before the refetch lands": the return plays the full entrance. That matches the spec. It is not worth extra machinery, but the D14 add-panel round trip should wait for the refetch to land before it navigates, or it will flake.
- The carried-over notes still apply:
  - Report 40ms vs ~30ms palette stagger in the PR (task 6.7).
  - Judge the lift shadow and the D5 near-cut on screen at the final gate.
  - The D13 numbers are the condition on the grid sign-off.
