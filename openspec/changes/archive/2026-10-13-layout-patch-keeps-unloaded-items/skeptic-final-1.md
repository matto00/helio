## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 57e329da7735ab58e0feb2c06471f2ea84a9da5a. Diff base: 67cf9e0e0451b781be463e82db25c57a8c8795bf, resolved live with `resolve-review-base.sh` (exit 0).

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/layout-save-unloaded-panel-items/HEL-1527`.

**Diff scope.** The code changes are confined to six files under `frontend/src/features/dashboards/state/`: `layoutPatch.ts`, `dashboardsSlice.ts` and four test files. The rest of the diff is openspec artifacts. There are no backend, schema or migration changes.

**AC1: `buildLayoutPatch` keeps unloaded panels' stored items on substitution, and a jest test fails without the fix. Met.**
- `layoutPatch.ts:47-50` substitutes `[...resolved[bp], ...unloadedItems(next[bp], resolved[bp])]`.
- `unloadedItems` (L19-29) skips blank and repeated ids, matching `resolveDashboardLayout`.
- **Red, reproduced by me independently.** I built a scratch copy of HEAD (`git archive`) with the pre-fix `layoutPatch.ts` and `dashboardsSlice.ts` from 67cf9e0e0, then ran jest with 3 workers under `nice -n 19`. Result: `Tests: 12 failed, 6 passed, 18 total`.
  - All 3 new `buildLayoutPatch` tests fail.
  - The key test, "keeps an unloaded panel's authored item…", fails for the right reason: the received `xs` lacks exactly the `{panelId:"u",x:0,y:8,w:1,h:2}` item (diff `- Expected - 7 / + Received + 0`, `layoutPatch.test.ts:47`).
  - All 9 new rejection-copy tests fail against the pre-fix slice.
  - The red is genuine.

**AC2: an overlap rejection caused by an unloaded panel shows user-facing copy with no raw ids. Met.**
- Every rejection of `updateDashboardLayout` now resolves to one of two strings:
  - initial non-409 path: `dashboardsSlice.ts:248-251`, `rejectionCopy`
  - unresolvable 409: L262-264, `LAYOUT_CONFLICT_MESSAGE`
  - retry failure: L272-279, conflict copy or `rejectionCopy`
- `extractErrorMessage` is no longer reachable from this thunk.
- The thunk can only throw (as opposed to reject with a value) if `dispatch` or `getState` throws. In that case `payload` is undefined, and the toast listener falls back to its own literal (`toastListeners.ts:170`, `typeof payload === "string" ? payload : fallback`).
- `toastListeners.ts:170` is the only consumer of `updateDashboardLayout.rejected` (grep).
- No raw id can reach the toast on any path.

**Live check, run by me.** I started the servers with `start-servers.sh`; `assert-phase.sh servers` returned PASS. I used a throwaway user efbe2116-2dce-475f-9579-8f252857276c / hel1527-skeptic-1791901307066@example.test with the `ops` template. An XHR shim stacked the PATCH items at (0,0) and dropped `expectedLayoutVersion`.
- **Generic branch.** The server answered `400 {"message":"Layout rejected: breakpoint 'sm': panels '7f5cd484-…' and '402e4eeb-…' overlap; …"}`. The toast read "Failed to save dashboard layout."
  - Dark: `/home/matt/Development/helio/.concertino/runs/HEL-1527/evidence/.concertino/skeptic-evidence/hel1527-generic-toast-dark.png`
  - Light: `/home/matt/Development/helio/.concertino/runs/HEL-1527/evidence/.concertino/skeptic-evidence/hel1527-generic-toast-light.png`
- **New conflict branch, exercised live.** I first created panel 79f3fd77-… out of band with a raw `POST /api/panels`, so the tab never loaded it. A save then got a 400 with UUIDs in the body. The re-synced layout named the unloaded panel. The toast read "This dashboard's layout was changed elsewhere; your last layout change was not saved." with no ids.
  - Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1527/evidence/.concertino/skeptic-evidence/hel1527-conflict-toast-dark.png`
- **After a reload** (so the panel was loaded), the same 400 gave the generic copy, as D3 predicts.
- **Cleanup.** I deleted the user by exact (id, email) via `buildUserDeleteSql`, and the follow-up count returned 0. I stopped the servers with `stop-servers.sh` (`STOPPED ports=6959,9866`).

**Only existing copy is used.** At base, `git grep` finds both strings:
- `"Failed to save dashboard layout."` in `dashboardsSlice.ts:218,245` and `toastListeners.ts:170`
- `LAYOUT_CONFLICT_MESSAGE` in `layoutConflict.ts:12`

The only new capitalised string literals in the diff are `"Failed to save dashboard layout."` and the test-only `"Network Error"`. No new user-facing wording was added.

**I1 (HEL-1525) is untouched.**
- The diff does not touch `useLayoutSave.ts`, `persistedVersionRef`, `baseVersion` or the `updateDashboardLayout.fulfilled` reducer. The hunks in `dashboardsSlice.ts` are only L166-191 and L210-280.
- On a rejection, `useLayoutSave.ts:276` still returns before any baseline or version adoption.

**Gates, re-run by me with 3 workers under `nice -n 19`.**
- jest over `src/features/dashboards`, `src/features/toasts`, `src/features/panels/hooks` and `src/features/panels/ui/grid`: `Test Suites: 75 passed, 75 total; Tests: 557 passed, 557 total`.
- `npm run typecheck`: exit 0.
- `eslint --max-warnings=0` over `src/features/dashboards/state`: exit 0.
- I did not re-run the whole-suite shards. I relied on the evaluator's pasted 4-shard numbers (7004 passed, 0 failed) plus 49 root suites, together with my own targeted run.

**Spec delta.** The design-gate note 1 (409 wording) is fixed: "a status other than `400` or `409`".

**Does reachability.md overclaim? Yes, in one bullet; its conclusion holds.**
- The bullet "Placement/interaction/undo branches … none introduces another writer's unseen item" is false as stated. `detectPlacementExtension` (`layoutPlacement.ts:13-30`) matches any store layout that is the previous layout plus appended unknown ids. The placement branch (`useLayoutSave.ts:195-222`) never calls `refetchPanelsIfLayoutNamesUnknown`.
- I looked for a deterministic, non-race way to get another writer's appended layout into the store while the user's layout equals the baseline:
  - `useResourceIndexing.ts:77` refetches dashboards only when the index status is idle or failed.
  - The proposal and patch-set upserts come from this tab's own actions.
  - The 409 and 400 re-syncs reach the placement branch only if the store already equals the baseline. That needs the user to undo during an in-flight save (the evaluator's race).
- I found no deterministic path. "No deterministic live path" therefore stands, and the shipped fix covers the race anyway.

### Verdict: CONFIRM

### Non-blocking notes
1. **reachability.md overclaim.** Reword the placement bullet before archive. It should say that the placement branch accepts any "previous plus appended" store layout without a refetch, and list the undo-during-in-flight-409 race next to the existing residual. The overall finding is unchanged.
2. **Evaluator evidence gap.** evaluation-1.md cites `hel1527-generic-toast.png` as showing the toast. The persisted image shows no toast: it was captured after the toast was gone, or before it appeared. The claim was true (I reproduced it with the toast visible), but that screenshot does not evidence it. This is not an mtime issue, so there is no mtime gate defect to record.
3. **Two definitions of the generic string.** `LAYOUT_SAVE_FAILED_MESSAGE` (`dashboardsSlice.ts:172`, not exported) duplicates the `toastListeners.ts:170` fallback. Exporting the constant and reusing it would stop the two drifting apart.
4. **files-modified.md is incomplete.** It omits `openspec/changes/layout-patch-keeps-unloaded-items/specs/dashboard-layout-validation/spec.md` and `.openspec.yaml`, which this commit also adds. The paths it does list are complete and repo-relative.
5. **Dashboard-switch edge (design-gate note 2) remains.** During `fetchPanels.pending` for B, `items` still holds A's panels. A 400 in that window would show the conflict copy rather than the generic one. Either string is id-free, so AC2 holds.
