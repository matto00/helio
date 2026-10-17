## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: c8e204e065a817babc5ef5a74df8878bb4af73c0. The only difference from main is the untracked change directory.
Scope: items 1-5 and 7. I treat D12 (items 6 and 8) as pending, not as a decided scope cut.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/motion-pass-primitives/HEL-1584`.
- **`openspec validate motion-pass-primitives --strict`** returned "Change 'motion-pass-primitives' is valid". A `## Purpose` heading in a new-capability delta has archived precedent (`2026-10-16-motion-foundation-primitives/specs/motion-primitives/spec.md`).

#### Round-1 change requests, re-checked against the tree

- **CR1 (expand runs before the dialog opens): addressed.**
  - In `Modal.tsx`, the "Sync open prop" effect is a passive `useEffect`, and `if (!dialog.open) dialog.showModal()` is its only `showModal()` call site. D8 now makes `expandFrom` a plain function called right after that line.
  - The `ui-modal--expanding` class is decided at render, so it is present before `[open]`. `useMotion()` (`ThemeProvider.tsx:169`) works without a provider, so `Modal` can call it safely.
  - The red-capable test "never called while `dialog.open` is false" is in D8 and in task 4.2.
  - `PanelCard`'s `<article onClick>` (`PanelCard.tsx:192`) makes `e.currentTarget` the card. The Customize path (`handleDetail`, no event) and the mobile path (`handleItemClick(panelId, e)`) both exist as D8 describes.
- **CR2 (D3/D4 API mismatch): addressed.**
  - `entranceOf` returns `{ phase, index }` and never a className. `entranceClassProps` is limited to flow lists.
  - The grid uses `data-entrance` plus `--motion-index` on the wrapper div. The test "no `.react-grid-item` carries `motion-enter`/`motion-pop`" is in task 3.3.
  - (a) The active breakpoint is set through `getBreakpointFromWidth`. (b) `--motion-duration-emphasized` is consumed by the desktop rule, and DESIGN.md:1124 reserves it for "panel/card rise only". (c) The latch is held in `PanelGrid`, and a shell swap clears it at render time. `PanelGrid.tsx` is in fact where `isPhone` is decided.
- **CR3 (contradiction over what counts as "cold"): addressed as worded.** The "first dashboard of the session" clause is gone, and the spec's "Warm restore is instant" scenario names the reload path. A new gap in the same rule is CR1 below.
- **CR4 (Crossfade changes the box of what it wraps): mostly addressed.**
  - The `block` option is defined, and `.crossfade__layer` is `display: flex` today (`Crossfade.css`), so the option is needed.
  - The loading condition is stated exactly: `showPanelGridSkeleton || showBootstrapSkeleton`, which matches `PanelList.tsx` :415.
  - `.app-content` is a block, `overflow-y: auto` container (`App.css:307`), so a block layer keeps the route page in normal flow. Width is the right thing to assert.
  - Gap: the route-page width check that D5 promises appears in no task. See CR3.
- **CR5 (route already resolved, yet the content still fades): addressed.**
  - The `skeletonPainted` rule is sound for the cached-chunk case. `ReadySignal`'s layout-effect `setState` forces a synchronous re-render, React flushes the pending passive effects first, and Crossfade's mount `requestAnimationFrame` has not fired by then. So `skeletonPainted` is still false and the swap has no fade.
  - Each of the four `AppRoutes.tsx` boundaries wraps exactly one lazy page as its route element (:128-162), so one route cannot suspend twice inside the same `RouteSuspense`.
- **CR6 (merge signature lets stale options survive): addressed.** The signature is now the whole option with only the data stripped, and an "axis name/`min` removed → notMerge" test is listed.
  - I checked `features/panels/ui/chartDataOptions.ts` for data-derived structure. `legend.data` equals the group names (:129, :187), and the group names are also the series names, so a change in groups correctly forces a full replace. A single-series line chart's `legend.data` is `[header]`, which is stable, so the morph AC is reachable.
- **CR7 ("dirty to clean" treated as "save completed"): addressed.**
  - `updateDashboardLayout` is dispatched only from `useLayoutSave.ts:266`. `updatePanelsBatch.fulfilled` exists (`panelsSlice.ts:313`). `resetPanelSaveState` (:134) only clears state, so no save sequence moves.
  - Tests for "undo to clean → no check" and "reset → no check" are in task 5.3.
- **CR8 (D13 gaps): addressed.**
  - (a) Baseline in the worktree before any source change.
  - (b) Numeric thresholds for commits, CLS, time to first card content, long tasks and frame intervals, with "noise" defined as the base run's spread.
  - (c) The `hel1575-switch-measurement` move is stated in advance (about +280ms on the skeleton proxy) and justified.
  - (d) The reference now points to D13.
  - The expected "+1 commit (Crossfade `skeletonGone`)" matches `Crossfade.tsx`: `setSkeletonGone` runs in its rAF or `transitionend` callback, so it is its own commit.
- **CR9 (Crossfade spec contradiction): addressed.** The requirement is now MODIFIED. It carries both base scenarios verbatim (base `openspec/specs/motion-primitives/spec.md` "Crossfade") and adds the options.

#### Driver invariants

- D5 keeps `key={selectedDashboardId}` on `PanelGrid` and the skeleton's dashboard-id key.
- Neither D4 nor D5 feeds `layouts`, the breakpoint, `cols`, `width`, the compactor, the handlers or the child keys.
- The skeleton condition includes `!panelsMatchDashboard(items, selectedDashboardId)` (`PanelList.tsx:121-126`). A same-dashboard refetch therefore never unmounts the grid, and a background `fetchPanels.fulfilled` cannot replay the entrance on a mounted grid.
- My round-1 sign-off of the D4/D8 touch stands. CR2, its condition, is met.

#### Sibling overlap

HEL-1583's frontend diff (`git diff --stat c8e204e06...origin/feature/mobile-dashboard-glass-nav/HEL-1583 -- frontend`) touches `MobilePanelStack.css`, not `.tsx`. Its `PanelList.tsx` hunks are in the zoom and phone-shell regions, not the :415 ternary. The design's Risks entry is accurate.

#### New findings in the revised design

- **Route re-entry replays the stagger.**
  - `showDashboardPanels` is dispatched from `AppShell` (`App.tsx:177-182`), with deps `[selectedDashboardId, tabsHydrated]`, not from `PanelList`.
  - Going `/dashboards` → `/home` → `/dashboards` unmounts and remounts `PanelList`. That issues no fetch (`fetchPanels`' condition, `panelThunks.ts:80-89`, returns false on `succeeded` for the same id) and no restore. `itemsOrigin` is therefore still `"network"` from the original fetch.
  - The newly mounted `PanelGrid` latches `playEntrance = true` and the whole stagger plays again on every return from Home, Sources or Settings.
  - This contradicts HANDOFF.md:29 ("Return within the TTL = instant") and D4's own intent that only an arrival from the network staggers. No spec scenario or test covers it.
- **`duplicateDashboard.fulfilled` and `importDashboard.fulfilled` replace `items`** (`panelsSlice.ts:318-329`), but D4 sets `itemsOrigin` only in `fetchPanels.fulfilled` and `panelsRestored`. After a duplicate or import, whether the new dashboard's grid staggers depends on how the previous dashboard was loaded.

### Verdict: REFUTE

All nine round-1 change requests are addressed in substance, not just re-worded. The revisions leave one real behavioural hole in the D4 rule (CR1) and two small gaps in what is specified (CR2, CR3). All three are cheap to fix in the artifacts.

### Change Requests

1. **D4: define and test route re-entry.** State what happens when `PanelList` remounts with the selected dashboard's panels already loaded: return from `/home`, `/sources`, `/settings` and so on (evidence: `App.tsx:177-182`, `panelThunks.ts:80-89`).
   - Expected rule, per HANDOFF.md:29: no entrance. The stagger plays at most once per network load.
   - Name the mechanism. One option: a per-load token in the slice (for example, `fetchPanels`' `requestId` recorded on fulfilled), plus a record of the last token that played. The record must not add a commit on load, or D13's "+1 commit" budget must name it.
   - Add a "Returning to a loaded dashboard is instant" scenario to `specs/surface-motion` "Panel grid motion".
   - Add a PanelGrid/PanelList component test: mount, unmount, remount with the same store, and expect no `data-entrance="enter"`.
   - Add a D14 e2e step: dashboard → Home → dashboard under Full, with no grid entrance on the second visit.
2. **D4: state `itemsOrigin` for `duplicateDashboard.fulfilled` and `importDashboard.fulfilled`** (`panelsSlice.ts:318-329`). Both are server responses, so presumably `"network"`, and they count as a load for CR1's token. Add them to task 3.2's slice tests.
3. **Tasks: carry the route-page width check D5 promises.** D5 says a real-browser check asserts "the route page (D6) as wide as its outlet", but task 3.4 lists only the grid root and the mobile stack. Task 2.5 and D6's tests are unit-level, and jsdom cannot measure width. Add the route-page check at 1440 and 375 to task 3.4 or 6.3, on one of the four `RouteSuspense` routes (for example `/proposals/review`).

### Non-blocking notes

- **D8, StrictMode.** The parenthetical "not on a StrictMode re-run that finds it already open" is inaccurate. `main.tsx:113` uses `<React.StrictMode>`, and Modal's unmount effect closes the dialog in StrictMode's simulated unmount. The re-run therefore finds the dialog closed, calls `showModal()` again, and in dev calls `expandFrom` twice. This is harmless (the second animation replaces the first). Correct the wording, and do not write a "called exactly once" test under StrictMode.
- **D10, where the signature ref is updated.** If `ChartPanel` updates the previous-signature ref during render, StrictMode's double render makes the second render see an unchanged signature on first mount. Update it in an effect, or compare against the last committed signature.
- **D4 CSS trap.** `--motion-stagger-cap` is declared only inside `.motion-enter` (`motion.css:16`). A PanelGrid rule on `.panel-grid-card` that reuses `var(--motion-stagger-cap)` would get an invalid `min()`, which invalidates the whole `animation` declaration, so nothing animates. `check-tokens` cannot catch this because the variable is declared somewhere. Declare the cap in the grid rule, or move it to `:root`. D14's "Full control must animate" check would catch the failure, but only late.
- **D5, paint order.** The content layer comes after the skeleton in DOM order and has no z-index, so it paints on top. With `contentFade={false}`, the skeleton therefore fades out underneath the grid, not over it as D5 says. On a reload restore that showed the skeleton, the swap is effectively a cut wherever the cards cover the skeleton cards. That is consistent with "restore = instant", but correct the wording and judge it on screen at the final gate.
- **D4, mobile timing.** It is not specified whether `MobilePanelStack` uses `emphasized` (the desktop rule does). Pick one so the two shells match.
- **D3, empty first render.** On a dashboard first shown empty, the first panel added is the "first non-empty keys" array and gets `enter`, not `pop`. The visual difference is minor, but the test list should state which is intended.
- **D11a, flush saves.** The save sequences are global. A flush save of dashboard A that settles after switching to B shows the check on B's indicator. This is acceptable, but note it.
- **Wrong references.** `utils/chartDataOptions.ts` (design Context, D10, proposal Impact) is actually `features/panels/ui/chartDataOptions.ts`. Non-Goals says the stale-label follow-up is "D9"; it is D11.
- Round-1 notes still apply: surface 40ms vs 30ms in the PR (task 6.7 does this), and judge the lift shadow on screen (Risks does this).
