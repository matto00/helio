## 1. Red-first evidence

- [x] 1.1 Write a failing test against current main: a cross-filtered table bound to an Output with more than one page reports the loaded-window count, not the whole-Output total; record the red output.

## 2. Capabilities and ops hook

- [x] 2.1 Add `useOutputFilterCapabilities(outputId)`: lazy (only when a cross-filter is active and the panel is a candidate), cached per outputId with 5-minute TTL, invalidated on a 400 for the cross-filter eq (then client-fallback); failure => ineligible.
- [x] 2.2 Add `useCrossFilterServerOps(panel, output)` returning `{ crossFilterEq, mode: "server" | "client-fallback" | "none" }` per design D3.

## 3. Compose on every render path

- [x] 3.1 Per D1/D9a-i/D9a-ii/D9b: add the separate `crossFilterEq` parameter (NEVER concatenated into `controlFilterOps`) to `usePanelSortFilter`, `usePanelData`, `handleLoadMore`, the `fetchPanelPage` arg (thunk folds it into `filter.ops`) and `PanelDetailModal`, joining each ops key and corrective-mount condition; record `lastQuery` (page-0 pending only; fulfilled/rejected carry forward) and replay it in `usePanelData` mount/`refresh()` with outputId scoping and current-crossFilter reconciliation; thread `crossFilterMode` to PanelFullscreenOverlay from PanelCard and make it a required prop of PanelContent/OutputPanelContent.
- [x] 3.2 Gate the client-side filter in `useCrossFilteredPanelData` and `OutputPanelContent` on `mode === "client-fallback"` so a panel is never filtered by both paths; loaded-scope disclosure only on fallback.

## 4. Announcement

- [x] 4.1 Extend the live-region text per D7 (set + clear), announced after the fetch settles.

## 5. Tests

- [x] 5.1 Server path count/hasMore (task 1.1 turns green); same-column AND composition; fallback path; origin/unaffected panels; clear with stale in-flight response; load-more carries eq.
- [x] 5.2 Only `PanelInspectView` dispatches `setCrossFilter` (source-scan test).
- [x] 5.3 Public viewer path emits only control-scoped filters (no cross-filter).
- [x] 5.4 Verify numeric-typed server `eq` parity vs client `cellMatchesValue` with a real request; timestamp columns take the fallback; string columns exact text (D10).
- [x] 5.6 Mobile-stack remount with an active cross-filter never renders unfiltered sibling rows; 400-detection thunk test + one test per dispatch class (page-0 effect, load-more).
- [x] 5.7 lastQuery: rebind to another Output replays nothing; clear-while-unmounted drops the stale eq; load-more does not overwrite lastQuery; fulfilled/rejected carry it forward; usePanelData ignores `cross-filter-eq-rejected` (mount/refresh class).
- [x] 5.5 Refresh (manual/poll) keeps the eq op on desktop and mobile hosts; detail modal server vs fallback mode; 400 on eq flips to fallback; announcement not emitted while loading.

## 6. Live verification

- [ ] 6.1 Desktop grid and mobile stack, light and dark themes, compared against the running app per DESIGN.md; screenshots under the evidence dir, never repo root.
- [x] 6.2 Run lint, typecheck, prettier, jest; record any flake verbatim.

## Standing Constraints

- [C1] Red-first: reproduce the loaded-window count against current main before the fix; live-verify desktop grid AND mobile stack in both themes vs the running app per DESIGN.md; screenshots never at repo root; record any flake test name+message verbatim in evidence.
- [C2] Bash calls that run hooks/sbt/jest/CI use timeout 600000; max 3 workers, nice -n 19; verify dev servers serve THIS worktree via readlink /proc/<pid>/cwd; use git -C.
- [C3] Any post-final-CONFIRM commit changing code or tests needs a fresh final verdict; state which kind. Running out of any budget is a mandatory escalation to the driver.
- [C4] cross-filter op travels ONLY as the separate `crossFilterEq` parameter (never concatenated into `controlFilterOps`); executor confirms user sort/filter persistence for lastQuery replay reconciliation in evidence.
