## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 98b8c40e9ffd99491482a28b609cbe556f293a45 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/pipeline-hooks-session-check/HEL-1798`.
- **Epoch mechanism (design Context):** `frontend/src/shared/session/sessionEpoch.ts` exports `getSessionEpoch`,
  `bumpSessionEpoch`, `dispatchIfSameSession`. `sessionEpochMiddleware.ts` bumps on `clearAuth`, records the epoch at
  `pending`, and on a changed epoch `return action` without `next` (drops from reducers). RTK's thunk returns
  `finalAction` regardless, so the claim "the promise still resolves with the dropped action" and "a new thunk
  dispatched after the bump is let through" both hold.
- **"Sign-out unmounts the pipeline page via ProtectedRoute":** CONFIRMED. `clearAuth` sets
  `auth.status = "unauthenticated"` (`authSlice.ts:259-262`); `ProtectedRoute.tsx:18-22` renders `<Navigate to="/login">`;
  `/pipelines/:id` is under it (`AppRoutes.tsx:126`). So a `mountedRef` check does hold across sign-out.
- **Design table rows** (read each file in full):
  - `usePipelinePageLoad.ts:67-69, 75-77` ungated; `142-147` mountedRef-only. Correct. (`onStepsSettled`/`onOutputsSettled`
    are local `setStepsFetch`/`setOutputsFetch` setters, `usePipelineStepsSeed.ts:57-64`, not dispatches.)
  - `usePipelineStepStructure.ts:59, 124, 132, 136` ungated. Correct.
  - `usePipelineDraftSave.ts:164, 173` ungated; `170` behind `mountedRef` at 168. Correct.
  - `useOutputImmediateActions.ts:35` ungated, no mountedRef. Correct.
  - `useRunHistory.ts:99-107` gated only by `openIdRef`. Correct.
- **Enumeration:** re-ran `openspec/changes/archive/2026-11-20-reset-per-user-state-on-logout/post-await.sh frontend/src/features/pipelines`.
  It only reports lines containing literal `dispatch(` within 30 lines after an `await`/`.then(`. It cannot see a
  **dispatching callback** called after an await (`syncStepsFromServer()`, `refreshRunHistoryAfterRun()`,
  `refreshVisibleOutputPreviews()`). D1's own goal names "every dispatching callback". Reading every hooks file with an
  `await`/`.then` (`grep -lE "await |\.then\(" hooks/*.ts`, 19 files), I found unguarded sites the plan misses (CR1, CR2).
- **Tidy claims:** `sessionResetGuard.test.ts:173` and `:184` are byte-identical tests (CONFIRMED). The casts are at
  `recentVisitsListeners.ts:75-76` (CONFIRMED). `sessionStateAllowlist.ts` has 547 lines and one importer,
  `sessionResetGuard.test.ts:39` (CONFIRMED).
- **Spec delta:** the MODIFIED header matches `openspec/specs/sign-out-client-state-reset/spec.md:29` exactly, and the
  original scenario is carried forward. OK.
- **Test feasibility (D4):** the reds can be produced with the hook still mounted. For `usePipelineDraftSave`, 164 comes
  before the 168 `mountedRef` check, and 170 is reached because the hook stays mounted. For `usePipelinePageLoad` the
  mount-effect `.then` has no ref at all. `retryStepsLoad`'s `mountedRef` is true while mounted, so the analyze
  re-dispatch is observable. For `useRunHistory`, `openIdRef` is unchanged by `clearAuth`. All are achievable.
  Caveat: there is no "store/store.ts factory". `store.ts:109` exports a singleton, and only `store.ts` wires
  `createSessionEpochMiddleware`. No test-store helper includes it today (see CR4).

### Verdict: REFUTE

### Change Requests

1. **The non-goal "`usePipelineRootAndToggleActions` ... post-await dispatches are already behind a `mountedRef`
   check" is false.** `usePipelineRootAndToggleActions.ts:153-161` (`handleDuplicateStep`) does
   `await duplicatePipelineStep(stepId); await syncStepsFromServer();` with no `mountedRef` check.
   `syncStepsFromServer` (`usePipelineStepStructure.ts:57-59`) dispatches a **new** `fetchPipelineSteps(id)` thunk. It
   records B's epoch at `pending`, so the middleware lets it through. Result: a request carrying A's pipeline id, with
   its result landing in B's reset `pipelines` state. That is the exact defect class of this ticket. Either fold this
   site in (epoch check, or at minimum the hook's existing `mountedRef`) with a red test, or correct the non-goal and
   justify the exclusion. Whichever you choose, the rationale must be true.
2. **Enumeration is incomplete for `features/pipelines` hooks. Add these sites, or exclude each one with a true
   reason:**
   - `usePipelineStepMutations.ts:77-88` (`handleRemoveStep`): `deletePipelineStep(stepId).then(() => syncStepsFromServer())`.
     No mountedRef or epoch check. It is a new `fetchPipelineSteps(A's id)` after sign-out.
   - `usePipelineRunAndSaveActions.ts:74-76` and `87-89` (`handleRunPipeline` / `handleDryRun`): after
     `await dispatch(submitPipelineRun(...)).unwrap()` (unwrap still returns the payload when the middleware dropped the
     fulfilled action), they call `refreshRunHistoryAfterRun()` (new `fetchPipelineRunHistory` thunk with A's pipeline
     id) and `refreshVisibleOutputPreviews(id)` (a new `previewOutput` per A's Output ids, `:59-66`). No mountedRef.
     This is the same pattern the plan already folds in for `useOutputImmediateActions`.
   - The cause is that `post-await.sh` only matches literal `dispatch(` lines. Task 1.1 must also enumerate calls to
     dispatching callbacks after an await/`.then`: at least `syncStepsFromServer`, `refreshRunHistoryAfterRun`,
     `refreshVisibleOutputPreviews`, `settleSaved`, `loadRunHistoryWhenTruncated`. `post-await-sites.md` must record each
     call site and its disposition. Update proposal.md (hook list, Impact, Non-goals), the design.md table, tasks.md §2
     (a red test per added hook) and the spec scenario's action list ("running the pipeline", "duplicating/removing a
     step") to match.
3. **The spec scenario contradicts the "direct service calls" non-goal for a site in scope.** The new scenario says that
   for "adding a step or Output ... no further request carrying A's pipeline or Output id is issued". But
   `usePipelineStepStructure.ts:124-126` (`handleAddOutputViaAggregateTail`) issues `createOutput(id, ...)`, a direct
   service **write** carrying A's pipeline id, right after `await syncStepsFromServer()`. D1 only gates "dispatches and
   dispatching callbacks", and the non-goals exclude direct service calls. Choose one of the following and write it into
   design.md:
   - (a) Place the check after `await createPipelineStep` and after `await syncStepsFromServer`, before `createOutput`.
     This gates every follow-on request in that handler, and the scenario then holds.
   - (b) Narrow the spec scenario's THEN so it does not promise no further request. The same contradiction applies to
     the general MODIFIED requirement text ("a further request") versus the `usePipelineShapeInstantiation` non-goal. Say
     explicitly that the requirement covers dispatches only, or scope the non-goal out of the requirement's reach.
4. **Two implementation decisions are left open:**
   - What `handleAddOutputViaAggregateTail` (typed `Promise<Output>`) does on a session change. A bare `return` does not
     type-check. Options are throw (which error? Its caller presumably surfaces a rejection as a toast or notice) or
     never resolve. Specify which, and that the caller tolerates it.
   - The D4 test store. "store/store.ts factory" does not exist (the store is a singleton at `store.ts:109`). State the
     construction: `configureStore` with `createSessionEpochMiddleware()` prepended, or the singleton plus a reset
     between tests. Note that the epoch is module-level state shared across tests in a file.

### Non-blocking notes

- `usePipelineDraftUndo.ts:51` calls `dismissSavedToast()` (dispatches `dismissToast`) after `await undoPatchSet` and
  before the `mountedRef` check at 53. It carries a toast id, not a pipeline id. This is harmless, but "behind a
  mountedRef check" is slightly overstated. Word the non-goal precisely.
- `usePipelineRootAndToggleActions.ts:89` and `useRunToUpdate.ts:23-25` push toasts after an await with no guard. These
  carry no ids and are fine to leave, but list them in `post-await-sites.md` with that disposition.
- `usePipelineRunStream.ts:69-75` dispatches previews and run-history from an SSE terminal event. Record whether the
  stream is torn down on unmount, so the enumeration states why it is out of scope.
- D2 is sound: `finally { draftSaveInFlightRef.current = false }` must stay outside the gate.
