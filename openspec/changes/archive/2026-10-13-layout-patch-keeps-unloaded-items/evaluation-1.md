## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 57e329da7735ab58e0feb2c06471f2ea84a9da5a. Diff base: 67cf9e0e0451b781be463e82db25c57a8c8795bf, resolved live with `resolve-review-base.sh`.
Changed code is all under `frontend/src/features/dashboards/state/`. There are no backend, schema or migration changes.

### Phase 1: Spec Review — PASS
- AC1 is met. `buildLayoutPatch` now sends `[...resolved[bp], ...unloadedItems(next[bp], resolved[bp])]` when it substitutes a breakpoint (`layoutPatch.ts:47-50`).
  - Red re-run by the evaluator: a scratch copy of HEAD with the pre-fix `layoutPatch.ts` from 67cf9e0e0 gives 3 failed, 5 passed. The 3 failures are the 3 new tests. This matches `red-evidence.txt`.
- AC2 is met. Every non-409 rejection of `updateDashboardLayout` now resolves to one of two strings:
  - `LAYOUT_CONFLICT_MESSAGE`
  - `"Failed to save dashboard layout."`

  Both rejection paths use `rejectionCopy`: the initial path at `dashboardsSlice.ts:248-251` and the retry path at `:272-279`. The conflict paths already used `LAYOUT_CONFLICT_MESSAGE`. `extractErrorMessage` is no longer reachable from this thunk. No raw id can reach the payload.
- No new user-facing copy. Both strings already existed: `layoutConflict.ts:11` and the `toastListeners.ts:170` fallback.
- I1 is untouched. `useLayoutSave.ts`, the fulfilled reducer, `persistedVersionRef` and `baseVersion` handling are not in the diff.
- All tasks are ticked and match the code. The spec delta passes `openspec validate --strict`. The MODIFIED requirement header matches the base spec at line 60. There is no scope creep. CONSTRAINTS is `[]`.
- Spot-checked reachability.md's file:line citations (`useLayoutSave.ts` L167-180/L174/L226/L257/L293, `panelsSlice.ts` L174-177/L184/L227-228, `DesktopPanelGrid.tsx:192`, `panelThunks.ts:113`). All match the code. One characterisation is overstated; it is non-blocking and covered under Suggestions.

### Phase 2: Code Review — PASS
The evaluator ran every gate fresh in WORKTREE_PATH, with `nice -n 19` and at most 3 workers:
- `npm run lint`: exit 0, zero warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm --prefix frontend run build`: exit 0.
- `npm test`, split into foreground shards:
  - Root jest: 49 suites, 458 tests passed.
  - Frontend jest, 4 shards (`--shard=1/4` … `4/4`): 146 + 146 + 146 + 146 suites; 1720 + 1471 + 1986 + 1827 = 7004 tests passed, 0 failed.

The slice tests were checked two ways:
- Red: against the pre-fix `dashboardsSlice.ts`, `dashboardsSlice.layoutReject.test.ts` gives 9 failed, 1 passed.
- Mutation probes, each a guard removed in a scratch copy, each caught by the matching test:
  - drop `status === "failed"`: 1 test failed ("panel list failed to load").
  - drop `isBadRequest`: 1 test failed ("500 with a ghost").
  - drop `resynced`: 1 test failed ("failed re-sync").
  - drop the `loadedDashboardId` check: 2 tests failed ("stale", "another dashboard").

Code quality:
- Types are narrow: `LayoutSaveState = Pick<RootState, "dashboards" | "panels">`. There is no `any`.
- Naming is clear, and the new `unloadedItems` mirrors `resolveDashboardLayout`'s handling of blank and duplicate ids.
- No dead code. `extractErrorMessage` is still used elsewhere in the slice.
- No CONTRIBUTING.md [mechanical] violation found (imports are at the top, no inline qualifiers).

### Phase 3: UI Review — PASS
- Servers were started with `start-servers.sh` and `assert-phase.sh servers` returned PASS. They were stopped with `stop-servers.sh` (`STOPPED ports=6959,9866`).
- Throwaway user: c22a2fc0-9fd8-4168-8e92-31ad0d88e6d4 / hel1527-eval-1791900938747@example.test, with the `ops` sample template. The user was deleted afterwards by exact (id, email) with `buildUserDeleteSql`; a follow-up count returned 0.
- **New-code path, live.** I installed an XHR shim that rewrites the outgoing layout PATCH so every item sits at (0,0), then dragged a panel and clicked "Save now".
  - The server answered 400 with `Layout rejected: breakpoint 'sm': panels 'd05032a6-…' and '3a0984ca-…' overlap…`.
  - The toast showed "Failed to save dashboard layout." with no ids, and the grid re-synced.
  - Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1527/evidence/.concertino/eval-evidence/hel1527-generic-toast.png`.
- **Other writer, live.** I created a panel out of band via `POST /api/panels`, then dragged and saved.
  - The server answered 409, the rebase was invalid, and the existing path showed "This dashboard's layout was changed elsewhere; …" with no ids.
  - After the re-sync the grid rendered all 4 panels.
  - This exercised the existing 409 path, not the new retry-400 branch. That branch is covered by the slice test "a non-conflict failure of the retry after a rebase".
- Console errors:
  - The 400 and 409 resource errors were caused on purpose.
  - A 502 on `/api/pipelines/:id/run-events` (an SSE stream through the Vite proxy) does not involve this change.
  - The 401s on `/api/auth/me` came before login.
  - There were no unhandled exceptions.
- Breakpoint resize was not exercised: the diff changes no CSS, markup or grid rendering, only the PATCH body and toast string. Accessibility is unchanged: the toast is in the existing "Notifications" region.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `reachability.md`'s second bullet says every path that brings a layout naming unknown panels into the store goes through the re-baseline branch (L226) or the post-save adoption (L293). That is too strong.
  - The placement branch (`useLayoutSave.ts:195-222`) is chosen by `detectPlacementExtension` (`layoutPlacement.ts:13-30`). It matches any store layout that is "previous layout plus newly appended ids", not only this tab's own `createPanel`, and that branch never calls `refetchPanelsIfLayoutNamesUnknown`.
  - A concrete race: a save is in flight; the user undoes back to the baseline; another writer has created panel P; the 409 rebase is invalid; then `showServerLayout(current)` upserts a layout equal to baseline plus P, appended. That takes the placement branch. P is now in the layout but not in the panel list, and `panelsLoaded` stays true.
  - The overall finding still holds, because this is a user-action-during-request race of the same kind as the residual the doc already lists, and the shipped `buildLayoutPatch` fix closes it anyway. Consider rewording that bullet and listing this race next to the existing residual.
- `"Failed to save dashboard layout."` is now defined in two places: `dashboardsSlice.ts:172` (`LAYOUT_SAVE_FAILED_MESSAGE`, not exported) and the `toastListeners.ts:170` fallback. Exporting the constant and reusing it in the listener would keep the two from drifting apart.
- `layoutNamesUnloadedPanel` (`dashboardsSlice.ts:182-191`) repeats the "layout names a panel outside the known set" test from `useLayoutSave.ts:171-173`. A small shared helper, for example in `dashboardLayout.ts`, would cover both.
- `files-modified.md` uses complete repo-relative paths, which is correct. It leaves out `openspec/changes/layout-patch-keeps-unloaded-items/specs/dashboard-layout-validation/spec.md` and `.openspec.yaml`, which this commit also adds.
