## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 98b8c40e9ffd99491482a28b609cbe556f293a45. The planning artifacts are untracked in the change dir. Scope is
eight hooks, per the owner ruling `fold-in-all-8` (`events.jsonl` line 7, `escalation.answered`, `answer_source: human`).
I did not reopen it.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipeline-hooks-session-check/HEL-1798`.
- **Round-1 CR1 (`handleDuplicateStep`):** ADDRESSED. `usePipelineRootAndToggleActions.ts:153,161` runs
  `await duplicatePipelineStep`, then `await syncStepsFromServer()`, with no guard. It is now a table row, test 2.6, and a
  spec scenario action ("duplicates ... a step").
- **Round-1 CR2 (missed hooks, enumeration method):** ADDRESSED for the named sites.
  - `usePipelineStepMutations.ts:76-88` (the `.then(() => syncStepsFromServer())`) is now a table row.
  - `usePipelineRunAndSaveActions.ts:74-76` and `87-89` are table rows. `handleSave` at 111-112 only navigates to
    `/pipelines`, so "safe" is correct.
  - Task 1.1 now requires a second pass that searches for dispatching-helper calls. I discuss below how complete the
    table itself is (see CR1).
- **Round-1 CR3 (spec vs direct-service non-goal):** ADDRESSED.
  - D2 puts the checks after `createPipelineStep` (111) and after `syncStepsFromServer` (124) before the `try` at 125. That
    gates the `createOutput` request.
  - The out-of-scope direct-service sites are in hooks outside the eight, and the spec's requirement is scoped to "on the
    pipeline page ... the continuation of such a load or action", with the scenario listing only in-scope actions.
  - The MODIFIED header matches `openspec/specs/sign-out-client-state-reset/spec.md:29`, and the original scenario is
    carried forward.
- **Round-1 CR4 (open decisions):** ADDRESSED.
  - D3 throws an `Error`. I traced the rejection: `usePipelineDraftRouting.ts:243` returns the promise, and
    `PipelineDetailDialogs.tsx:56` passes it through. The rejection is actually caught at `OutputEditorSheet.tsx:274-283`
    (`catch { setSaveError(...) } finally { setSaving(false) }`), so it is tolerated.
  - D4 uses the singleton. `store/store.ts:109` is `export const store = configureStore(`, and `:127` prepends
    `createSessionEpochMiddleware()`. It is the only wiring site (grep finds no other). Epoch monotonicity is stated.
- **Line numbers in the design table:** I read all eight files in full. Every cited line is correct:
  - PageLoad 67-69, 75-77, 142-146
  - StepStructure 124/126/132/136
  - DraftSave 164/170/173
  - OutputImmediate 35
  - RunHistory 106
  - RootAndToggle 161
  - StepMutations 77-88
  - RunAndSave 74-76, 87-89
- **Out-of-scope dispositions:**
  - `usePipelineDraftCreate.ts:70` is a `.then` after `createPipelineStep`.
  - `usePipelineShapeInstantiation.ts:83-103` is the step loop plus `createOutput`.
  - `usePipelineRunStream.ts:69-71` dispatches previews from the SSE terminal handler.
  - `usePipelineStepCreation.ts:186` and `usePipelineLaneStepCreation.ts:104` set local state after `createPipelineStep`.
  - All of these exist as described and are recorded as follow-ups or safe.
- **D2 `finally`:** `usePipelineDraftSave.ts:186-189` stays unconditional. Correct.
- **Red-test feasibility (D4):** each table site runs with the hook mounted on current code, so each red is achievable.

### Verdict: REFUTE

### Change Requests

1. **Inside the eight hooks there are three more post-await continuations. They dispatch, or start requests, with the
   previous user's pipeline id, and the table neither gates them nor gives them a disposition.**
   - `usePipelineDraftSave.ts:226-234` (`reload`): after `await getPipelineWithDefinition(id)`, it calls
     `adoptDefinition(id, ...)`. `usePipelineDraftAdopt.ts:47-50` shows this dispatches `pipelineStepsReplaced`,
     `outputsReplaced` and `pipelineRootsReplaced` with A's pipeline id and A's steps and Outputs. That is exactly the
     ticket's stated worst case (A's id landing in B's reset `pipelines` state). It is guarded only by `mountedRef` (230).
   - `usePipelineRootAndToggleActions.ts:63-64` (`handleAddRoot`): after `await addPipelineRoot`, it calls
     `dispatch(fetchPipelineById(id))`. This is a new thunk, so the middleware lets it through. Guarded only by `mountedRef`.
   - `usePipelineRootAndToggleActions.ts:85-87` (`handleRemoveRoot`): after `await removePipelineRoot`, it runs
     `dispatch(fetchPipelineById(id))` and `syncStepsFromServer()`. Guarded only by `mountedRef`.

   The plan is internally inconsistent about `mountedRef`-only sites:
   - It gates `retryStepsLoad` (142-146, behind `mountedRef` at 143) and `settleSaved` (170, behind `mountedRef` at 168).
     D1 explicitly rejects `mountedRef` as the mechanism.
   - The Goals line says "in the eight hooks, nothing that dispatches ... runs after an await ... once the session epoch
     has changed".
   - Yet the three sites above are not in the table.
   - Task 1.1's disposition list still offers "mountedRef + unmount" as "safe", and the design says "a gated-scope hit not
     in the table above stops the executor: escalate".

   So the executor can read these sites two ways (gate them, or mark them safe), or it escalates mid-execution. Settle it
   in the design:
   - **Recommended option.** Add the three sites to the table (same hooks, so the hook count is unchanged). Extend
     tasks 2.3 and 2.6 with red tests for `reload` and for root add/remove. Add "reloads the saved pipeline, adds or
     removes a source" to the spec scenario's action list.
   - **Alternative.** State one rule for `mountedRef`-only sites inside the eight (for example, "safe because sign-out
     unmounts via `ProtectedRoute`") and apply it consistently. That means removing the epoch gate from 146 and 170, or
     explaining why those two differ. Then correct the Goals sentence so it does not promise more than the table delivers.

### Non-blocking notes

- D3 names `PipelineDetailDialogs.tsx:56` as the caller that "already handles a rejection". It only passes the handler
  through. The handling is at `OutputEditorSheet.tsx:274-283`. Cite that in `post-await-sites.md`.
- D3 has a side effect worth recording under Risks. Throwing after `createPipelineStep` and before `createOutput`
  deliberately skips the catch's rollback (`deletePipelineStep`, a request with A's step id). That leaves an orphaned
  aggregate tail on A's pipeline server-side. This is the correct trade-off, but it should be stated.
- Skipping `onStepsSettled`/`onOutputsSettled` gates local setters (`usePipelineStepsSeed.ts`), not dispatches. That is
  harmless and already noted under Risks.
