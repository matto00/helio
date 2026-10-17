## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: c8e204e065a817babc5ef5a74df8878bb4af73c0. The only difference from main is the untracked change directory.
Scope: items 1-5 and 7. I treat D12 (items 6 and 8) as pending, not as a decided scope cut.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/motion-pass-primitives/HEL-1584`.
- **`openspec validate motion-pass-primitives --strict`** returned "Change 'motion-pass-primitives' is valid".

#### Round-2 change requests, re-checked against the tree

- **CR1 (route re-entry replays the stagger): partly addressed. There is a remaining hole, see the new CR1 below.**
  - D4 now adds `loadId` and `useFirstMountForToken(scope, dashboardId + ":" + loadId)`. The spec gains "Returning to an already-loaded dashboard", and tasks 3.3 and 6.3 gain the remount test and the Home round-trip e2e step.
  - The return path is correct: `App.tsx:177-182` stays mounted across routes, and `showDashboardPanels` → `fetchPanels` is a no-op on `succeeded` for the same id (`panelThunks.ts:80-89`). The returning `PanelGrid` therefore sees the same `loadId`.
  - StrictMode is fine: the initializer is pure, and React keeps state across the simulated effect remount.
  - The token adds no state and no commit, so D13's "+1 commit" budget holds.
- **CR2 (duplicate/import origin): addressed.**
  - D4 names `duplicateDashboard.fulfilled` and `importDashboard.fulfilled` (`panelsSlice.ts:318-329`).
  - `dashboardsSlice.ts:507-517` selects the new dashboard. That re-keys `PanelGrid` with a new token, so the entrance plays as the spec scenario says.
  - Task 3.2 tests these reducers.
- **CR3 (route-page width check): addressed.** Task 6.3 now checks that a lazily loaded route page is as wide as its outlet at 1440 and 375.
- **Round-2 non-blocking notes: all addressed.**
  - D8's StrictMode wording is corrected, and the "called once" tests render without StrictMode.
  - D10 updates the signature ref in an effect.
  - D4's grid rule declares `--motion-stagger-cap`.
  - D5's paint-order wording is corrected.
  - The mobile shell uses `emphasized`.
  - The empty-first rule is stated.
  - D11a's global-sequence caveat is stated.
  - The `chartDataOptions.ts` path and the D11 reference are fixed (grep finds no `utils/chartDataOptions` and no stray "D9").

#### Driver invariants

- D4/D5 keep `key={selectedDashboardId}` on `PanelGrid` (`PanelList.tsx:425`) and the skeleton's dashboard-id key.
- No new input reaches layouts, breakpoint, cols, width, compactor, handlers or child keys.
- My earlier sign-off of the D4/D8 PanelGrid/DesktopPanelGrid touch stands. It remains conditional on the D13 before/after numbers in the PR.

#### New finding: a refetch while the grid is mounted re-arms the replay

The new token mechanism has a hole in the most common edit flow:

1. `createPanel` (`panelThunks.ts:114-115`), `swapPanelOutput` (:150-151), `duplicatePanel` (:183-184), `useLayoutSave.ts:174-175` and the patch-set apply (`patchSetsSlice.ts:236`) all call `markDashboardPanelsStale` and then `fetchPanels` on the dashboard that is on screen.
2. The grid does not unmount during that refetch:
   - `markDashboardPanelsStale` sets `staleDashboardId` to the selected id, so the `status === "idle"` arm of `showPanelGridSkeleton` (`PanelList.tsx:121-126`) is false.
   - The `loading` arm is also false, because `!panelsMatchDashboard(items, ...)` is false: `fetchPanels.pending` does not clear `items`.
3. `fetchPanels.fulfilled` therefore increments `loadId` while the same `PanelGrid` stays mounted. The latched `playEntrance` is unaffected, and the new panel pops, which is correct.
4. But D4 says "a **mount** effect records the token", so only the token from mount time (`dash:K`) is ever recorded. The live token is now `dash:K+1`.
5. The user goes to Home and back. `PanelList` remounts, `useFirstMountForToken` finds `dash:K+1` unrecorded, `itemsOrigin === "network"`, and the **whole grid staggers again**.

So "add a panel, open Home, come back" replays the full entrance. That is the round-2 CR1 defect returning through a different path, and it contradicts HANDOFF.md ("return within the TTL = instant").

The spec scenario only covers coming back "without its panels being fetched again", so it does not forbid this. Task 3.3's "new `loadId`: plays" test would even certify the replay if the new id came from a mounted refetch.

### Verdict: REFUTE

All three round-2 change requests and all the non-blocking notes are addressed in substance. One real behavioural hole remains in the new D4 token mechanism. It is cheap to fix in the artifacts.

### Change Requests

1. **D4 / `useFirstMountForToken`: record every token the mounted grid commits, not only the token at mount time.**
   - In D4, replace "a mount effect records the token" with an effect keyed on `[scope, token]`, so that a load that lands while the grid is on screen counts as shown. Define the primitive's contract that way in `specs/motion-primitives` "First mount per token", for example: "a token committed while mounted is recorded".
   - Add a task 3.2/3.3 test: mount; `fetchPanels.fulfilled` for the same dashboard while mounted (the `createPanel` path, so `loadId` changes and the grid stays mounted); unmount; remount with the same store; expect no `data-entrance="enter"`.
   - Narrow the "new `loadId`: plays" test to a new `loadId` that arrived while no grid for that dashboard was mounted.
   - Broaden the `specs/surface-motion` scenario "Returning to an already-loaded dashboard" to cover a refetch the user already saw. For example: "...comes back with no fetch of its panels since they were last shown".
   - Add a task 6.3 step: add a panel → Home → back under Full, with no grid entrance.

### Non-blocking notes

- D4 says "`!registry.has(token)`" for a `Map<scope, Set<token>>`. It means `registry.get(scope)?.has(token)`. Fix the wording so the test-only reset and the scope keying are unambiguous.
- D4's empty-first-render rule is moot in practice: `PanelGrid` mounts only when `items.length > 0` (`PanelList.tsx:421-433`), so the first panel on an empty dashboard mounts a fresh grid and its `enter` comes from the mount-time latch. The stated test is still harmless. Write it as a fresh mount with one panel, not as a keys `[]` → `[p1]` transition, which cannot happen.
- D14's prose does not list the Home round-trip step that task 6.3 carries. Add it for consistency.
- Earlier notes still apply: report the 40ms vs ~30ms stagger in the PR (task 6.7), and judge the lift shadow and the D5 near-cut on screen at the final gate.
