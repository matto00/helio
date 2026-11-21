## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 98b8c40e9ffd99491482a28b609cbe556f293a45. The planning artifacts are untracked in the change dir. I did not
reopen the eight-hook scope (owner ruling `fold-in-all-8`) or the `usePipelineDraftUndo` exclusion.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipeline-hooks-session-check/HEL-1798`.
- **Round-2 CR1 (three `mountedRef`-only sites):** ADDRESSED, using the recommended option.
  - `usePipelineDraftSave.ts:226-234` `reload`: line 229 awaits `getPipelineWithDefinition`, then line 232 calls
    `adoptDefinition`. It is now a design-table row that cites `usePipelineDraftAdopt.ts:47-50`.
  - `usePipelineRootAndToggleActions.ts:63-64` `handleAddRoot`: line 63 awaits `addPipelineRoot`, then line 64 calls
    `fetchPipelineById` behind `mountedRef`. It is now a table row.
  - `usePipelineRootAndToggleActions.ts:85-87` `handleRemoveRoot`: line 85 awaits `removePipelineRoot`, then line 87 calls
    `fetchPipelineById` and `syncStepsFromServer`. It is now a table row. The success toast after it (88) carries counts,
    not ids, so it is harmless.
  - The Goals line now says "every site in the table, `mountedRef`-guarded ones included". That matches what the table
    delivers.
  - Task 1.1's disposition rule now says "`mountedRef` alone is NOT a safe disposition inside the eight hooks". The
    contradiction from round 2 is gone.
  - Task 2.3 now covers "reload adopts nothing". Task 2.6 now covers "add root and remove root". The spec scenario now
    lists "adds or removes a source" and "reloads a draft".
- **Round-2 non-blocking notes:** both addressed.
  - D3 now cites `OutputEditorSheet.tsx:274-283` as the place the rejection is handled.
  - Risks now records the orphaned aggregate tail that D3's throw leaves behind, with the reason for accepting it.
- **Fresh sweep of all eight hooks for missed post-await work.** I grepped each hook for `await|.then|dispatch(|mountedRef`
  and read the handlers in full.
  - `usePipelineStepStructure.ts:57-71` `syncStepsFromServer`: after its own `unwrap` it only calls `setSteps`. Gating its
    callers is enough.
  - `usePipelineDraftSave.ts:139-167` `post`: the check D1 places after line 139 and before line 164 also stops the
    `saveDraft` request (167) and `setSseActive`.
  - `settleSaved` (`usePipelineDraftSettle`, which dispatches `fetchPipelineById` at line 98) and `adoptDefinition` are
    gated at their call sites, which is consistent with D1's "dispatching helper" rule.
  - Safe as dispositioned:
    - `usePipelineStepMutations.ts:184` reorder: local state only.
    - `usePipelineRootAndToggleActions.ts:120` enable toggle: local state only.
    - `usePipelineRunAndSaveActions.ts:111-112` `handleSave`: navigates to `/pipelines`, no id.
    - `useOutputImmediateActions` update/remove: no continuation after the await.
  - `usePipelinePageLoad.ts` mount effect: `loadRunHistoryWhenTruncated` is `useRunHistory.ts:97-110`, whose `.then`
    (106) is a table row. The `retryPipelineLoad` and `requestedRef` effects dispatch synchronously, not after an await.
  - Result: no in-scope site is missing from the table.
- **Outside-the-eight check:** `useRunToUpdate.ts:23` has a `.then` that only pushes a toast. Task 1.1's full-directory
  enumeration will disposition it as safe, and it is not a gated-scope stop.
- **Test feasibility (D4):** with `renderHook` the hook stays mounted, so each new site (`reload`, add root, remove root)
  is red on current code. On current code `mountedRef` is true and each continuation runs.

### Verdict: CONFIRM

### Non-blocking notes

- The design table names `handleToggleEnabled (120)`. The real name is `handleToggleStepEnabled`
  (`usePipelineRootAndToggleActions.ts:115`). The disposition is still correct.
- Task 1.1 refers to `post-await.sh` with no path. It lives at
  `openspec/changes/archive/2026-11-20-reset-per-user-state-on-logout/post-await.sh`.
- Test 2.3 should also assert that no `saveDraft` mock call is made after `clearAuth` (the request with A's id at 167),
  not only that no `draftSaveRunPending` is dispatched. D4's general "no follow-on service mock called with A's ids"
  already implies this.
