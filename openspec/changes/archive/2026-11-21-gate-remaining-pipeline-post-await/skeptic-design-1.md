## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD de44f85fb2b7779e3ceecdb54cfc095030d0f58a (worktree clean except the untracked change dir).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/session-check-pipeline-post-await/HEL-1810`.
- **The four sites exist as described, with no session check** (read in full at de44f85fb):
  - `usePipelineDraftCreate.ts:70-94`: `.then` calls `applyCreated` and, if `editedInFlight`, `updatePipelineStep(persisted.id, latest.config)` at :86. No `getSessionEpoch`.
  - `usePipelineShapeInstantiation.ts:83` `await createPipelineStep`, `:103` `await createOutput`, `:113` `pushToast` in the `catch`. No check.
  - `usePipelineRunStream.ts:39-81` `onTerminal`: `dispatch(resetRunScopedState())` :46, thunk that dispatches `previewOutput` :69-73, `refreshRunHistoryAfterRun()` :75. No await, so a plain await/epoch grep misses it. The design lists it explicitly. `usePipelineRunEvents.ts:80-82` stores `onTerminal` in a ref that updates every render, so a callback built from a mount-time `useRef` epoch is the one that runs.
  - `usePipelineDraftUndo.ts:43-67`: after `undoPatchSet` it calls `dismissSavedToast` (dispatches `dismissToast`) and `getPipelineWithDefinition`. After that it calls `adoptDefinition`, `draft.discard()`, `dispatch(fetchPipelineById(id))` :57 and `pushToast`. Only `mountedRef` guards it.
- **The rollback guard and the test gap**: `usePipelineStepStructure.ts`, `handleAddOutputViaAggregateTail` `catch`, has `setSteps(filter)` followed by `if (getSessionEpoch() === startEpoch) void deletePipelineStep(...)`. The existing `usePipelineStepStructure.sessionEpoch.test.tsx` has 4 tests, all after sign-out. None asserts that `deletePipelineStep` IS called within one session. The gap is real. D3's two mutations (`if (false)`, `===` changed to `!==`) both suppress the delete in one session, so a positive assertion catches both.
- **Re-enumeration**: I ran my own scan: non-test files in `features/pipelines/hooks/` that have `await`/`.then(` and no `getSessionEpoch`. It returned exactly the set design.md names: useDraftNodeCapabilities, usePipelineDraftCreate, usePipelineDraftUndo, usePipelineLaneStepCreation, usePipelinePreviewCache, usePipelineRunEvents, usePipelineShapeInstantiation, usePipelineStepCreation, useRunToUpdate, useStepPreviewFetch, plus the test kit. I spot-checked the non-goals:
  - `usePipelineStepCreation:186-205` and `usePipelineLaneStepCreation:104-117`: post-await work is `applyCreated` (local `setSteps`) plus a catch toast.
  - `useRunToUpdate:23-25`: the toast message comes from `runToUpdate.ts`, which only produces "Run started." / guard / generic text, with no ids.
  - `useStepPreviewFetch:121-130`: local state behind a request token.
  The scope of four holds, and so does the "no escalation" call.
- **Unmount premise for the mount-time capture**: `features/auth/ui/ProtectedRoute.tsx:22` renders `<Navigate to="/login">`, which supports "sign-out unmounts the pipeline page".
- **Test kit and prior art**: `features/pipelines/hooks/sessionEpochTestKit.ts` exists (`deferred`, `flushPromises`). The existing HEL-1798 test shows the planned pattern works as described: real `store` singleton, `clearAuth()` in flight, mocked service modules. `shared/session/sessionEpoch.ts` exports `getSessionEpoch`, and D1 needs no new export.
- **Spec delta**: the MODIFIED requirement reproduces the live requirement text and both existing scenarios exactly (compared with `openspec/specs/sign-out-client-state-reset/spec.md`) and adds two scenarios (the four sites, and the same-session rollback). `openspec validate gate-remaining-pipeline-post-await --strict` -> `Change 'gate-remaining-pipeline-post-await' is valid`.
- **AC coverage**: AC1 (one failing-first test per site) maps to tasks 1.1-1.5 and 2.2. AC2 (rollback red on mutation) maps to 3.1-3.2. AC3 (HEL-1634 guard and e2e) maps to 4.1-4.2. No task falls outside the ticket. Non-goals are explicit (shared/session, HEL-1807, HEL-1820).
- **Placeholders and contradictions**: none found. Proposal, design and tasks agree on files, sites and test names. Each D1 bullet states exactly where the early return sits relative to every dispatch and request.

### Verdict: CONFIRM

### Non-blocking notes

1. **Possible vacuous assertion in the run-stream test.** `clearAuth` resets the outputs slice, so after sign-out `selectOutputsForPipeline(getState(), id)` is empty. An assertion of "the `previewOutputs` service was not called" would pass even on ungated code. Assert instead on the thunk `dispatch` receives (or on `resetRunScopedState` and `refreshRunHistoryAfterRun`). In the same-session control, seed the store with an Output and set `draftSaveInFlightRef.current = false` with a `succeeded` event, so that the preview path is really reached.
2. **Undo test: seed the saved toast first.** `dismissSavedToast` dispatches only when `savedToastRef.current?.applicationId === applicationId`. Both the sign-out test and its control should seed `savedToastRef` (returned by the hook). Otherwise "no `dismissToast`" holds without the gate.
3. **Draft-create test needs an in-flight edit.** It must replace `stepsRef.current`'s step with a new `config` object while the create is in flight. Otherwise `editedInFlight` is false and "no `updatePipelineStep`" is vacuous. Task 1.1 already says "an edit landed in flight", and the control test will catch it if this is missed.
4. **Run stream has one check, so one mutation.** D4's "one mutation per new check" covers all three gated calls in `onTerminal` at once. That is fine, but record which assertion turned red.
