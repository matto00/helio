## Standing Constraints

(none yet)

## 1. One undo/redo entry point (D1)

- [x] 1.1 Add `features/layout/state/layoutHistoryThunks.ts` with synchronous `applyLayoutUndo(dashboardId)` /
  `applyLayoutRedo(dashboardId)` returning `boolean` (no dispatch and `false` when target or current layout is
  missing). Verify with a new `layoutHistoryThunks.test.ts` against a real store: applied undo/redo restore the
  target, move the history stacks, return `true`; empty history returns `false` and leaves state untouched.
- [x] 1.2 Rewire `useLayoutUndoRedo.ts` to call the thunks (`preventDefault` only when they return `true`) and drop
  its target/current selectors. Verify `useLayoutUndoRedo.test.ts` and `.regression.test.ts` pass (update dispatch-
  shape assertions to behaviour/state assertions where they asserted the old two-action sequence).
- [x] 1.3 Rewire `CommandBar.tsx` buttons to the thunks; remove `handleUndo`/`handleRedo` duplication and the unused
  imports/selectors. Verify with a new CommandBar test (real store): clicking Undo/Redo restores the same layout and
  history as the shortcut path, and both are disabled with empty history; `grep -n "undoLayout\|redoLayout\|
  setDashboardLayoutLocally" frontend/src/app/CommandBar.tsx` returns nothing.

## 2. Explicit traversal recognition (D2)

- [x] 2.1 Add `applied` to the per-dashboard history (set by effective `undoLayout`/`redoLayout`, untouched by
  `pushLayoutSnapshot` and by no-op traversals) and `selectAppliedLayout`. Verify in `layoutHistorySlice.test.ts`.
- [x] 2.2 In `useLayoutSave`, classify a traversal only when the revision changed AND the layout deep-equals
  `applied`. Verify with a grid test: no-op undo (target equals current, e.g. after a zero-move drag) followed by a
  server layout write re-baselines (no PATCH on flush, not pending). Record the red run against the pre-change
  classification.

## 3. In-flight PATCH response guard (D5)

- [x] 3.1 Add required `sentLayout` to `updateDashboardLayout`'s arg (not sent on the wire); `useLayoutSave` passes
  the authored `nextLayout`. Fulfilled reducer: adopt the payload layout and clear pending only when the local layout
  deep-equals `sentLayout`; otherwise update other fields, keep the existing layout object by reference, leave
  `hasPendingLayout`. Verify in `dashboardsSlice.test.ts` (both branches, including reference identity) and update
  the existing fulfilled tests for the new arg.
- [x] 3.2 In `persistLayout`'s `.then`, after updating the baseline, set pending = `latestLayoutRef` differs from it in
  both directions (dispatch `false` when equal) and keep `layoutPendingDispatchedRef` in sync. Also verify the
  equal-to-server case: drag, flush, a newer local change whose layout equals the response's layout, resolve ->
  pending false, next flush sends nothing, a later edit marks pending again. Verify with a grid test using a deferred PATCH mock: flush, drag to a new position before resolve, resolve
  -> store/grid still at the new position, pending true; next flush PATCHes the new position. Also undo-while-in-
  flight. Record the red run against main's behaviour.

## 4. Placement extension (D4, D3)

- [x] 4.1 In `useLayoutSave`, track the previous store layout and add the placement-extension case (exact prefix +
  appended new panel ids in every breakpoint) that extends the baseline. Document the four-way classification order
  in the file header. Verify: flip `DesktopPanelGrid.layoutCommit.test.tsx`'s "drag then a non-interaction store
  change" test to expect pending true and exactly one PATCH (dragged lg + new placement) on flush; keep "panel-create
  style store layout change re-baselines" green; record the red run of the flipped test on main's code.
- [x] 4.2 Overlap case: drag panel A onto the cell the server then places the new panel in. Verify the flushed PATCH
  breakpoint is valid (no overlapping items, within bounds) via `buildLayoutPatch`'s substitution, never the raw
  overlapping layout.
- [x] 4.3 Also cover undo-then-create and resize-then-create stay pending (one test each, or one parametrised test).

## 5. Docs (D6)

- [x] 5.1 Correct CLAUDE.md:105 to the real mechanism (staged on drag/resize stop, persisted by the 30s auto-save,
  Save now, or the desktop grid's unmount flush). Verify `grep -n "250" CLAUDE.md` shows no layout debounce claim.
- [x] 5.2 Canonical spec text outside requirements, edited directly and intentionally (archive only rewrites requirement
  blocks, so these are retained, not clobbered or duplicated): `openspec/specs/frontend-layout-persistence/spec.md`
  Purpose (already edited at planning) and `openspec/specs/write-path-audit/spec.md` "Write Path Reference" (table row 1,
  payload note 1, source-locations `PanelGrid.tsx` row) - state the real flush mechanism and current file locations
  (`features/panels/hooks/useLayoutSave.ts`, `usePanelUpdatesFlush.ts`). Verify after archive in Delivery that
  `grep -rn "250" openspec/specs | grep -i -E "debounc|layout"` returns nothing and the commit's OpenSpec hygiene hook
  passes.
- [x] 5.3 Update `features/layout/README.md` and the `useLayoutSave.ts` / `usePanelUpdatesFlush.ts` headers to point at
  the classification contract (HEL-1233 builds on it).

## 6. Verification

- [x] 6.1 Frontend gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, full `npm test` (known flake
  PanelCard.test.tsx:625 / HEL-1215 - rerun, do not fix).
- [x] 6.2 E2E: `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts` green unchanged against the worktree's own servers;
  add one e2e (new `e2e/hel1230-*.spec.ts`) for drag -> create panel -> Save now asserting the PATCH body carries the
  dragged position. Fallback if panel create cannot be made deterministic in e2e (it needs a bound Output): seed the
  panel's Output via the API in the test's setup as the HEL-1028 spec seeds its dashboard; if that still is not
  deterministic, record the reason in files-modified.md and rely on 4.1 plus the evaluator's live check.
- [x] 6.3 Backend untouched: confirm `git diff --stat` shows no `backend/` changes (so `sbt testFull` is not required
  for this change; run it only if a backend file changes).
- [x] 6.4 Red/green evidence for 2.2, 3.2, 4.1 recorded (test name, red output on the pre-fix code, green after).
