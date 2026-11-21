## Context

See proposal.md (Why). HEL-1634 (`openspec/changes/archive/2026-11-20-reset-per-user-state-on-logout/design.md` D2)
built `frontend/src/shared/session/sessionEpoch.ts` (`getSessionEpoch`, `bumpSessionEpoch`,
`dispatchIfSameSession`) and `sessionEpochMiddleware.ts`, wired only in the `store` singleton (`store/store.ts:109`).
The middleware bumps the epoch on `clearAuth` and drops a thunk's `fulfilled`/`rejected` from the reducers when the
epoch changed since its `pending`. Two facts (both confirmed by design skeptic round 1) shape this change:

- The thunk's promise (and `.unwrap()`) still resolves with the settled action/payload when the middleware dropped
  it, so a `.then`/post-`await` continuation still runs.
- A NEW thunk dispatched after the bump records the new epoch at `pending` and is let through: it issues a request
  carrying A's id under B's cookie, and its result lands in B's state.

Sign-out unmounts the pipeline page (`clearAuth` -> `ProtectedRoute` `<Navigate to="/login">`), so local React state
writes after an await are harmless; the defect is dispatches, dispatching helpers and service requests.

Sites in scope (98b8c40e9; owner ruling `fold-in-all-8`):

| Hook | Post-await work to gate |
| --- | --- |
| usePipelinePageLoad | mount effect `.then` -> `onStepsSettled` (67-69), `onOutputsSettled` (75-77); `retryStepsLoad` `.then` -> `onStepsSettled` + `analyzePipeline(id)` (142-146) |
| usePipelineStepStructure | `handleAddOutputViaAggregateTail`: `syncStepsFromServer` after `createPipelineStep` (124), `createOutput` after it (126), `fetchOutputs`/`previewOutput` after that (132, 136) |
| usePipelineDraftSave | `draftSaveRunPending` after `getPipelineWithDefinition` (164); `settleSaved` after `saveDraft` (170); `draftSaveRunSettled` in catch (173); `reload`: `adoptDefinition` (dispatches `pipelineStepsReplaced`/`outputsReplaced`/`pipelineRootsReplaced`, `usePipelineDraftAdopt.ts:47-50`) after `getPipelineWithDefinition` (229-232) |
| useOutputImmediateActions | `previewOutput` after `createOutput(...).unwrap()` (35) |
| useRunHistory | `fetchPipelineRunHistory` in the `fetchPipelineById` `.then` (106) |
| usePipelineRootAndToggleActions | `handleDuplicateStep`: `syncStepsFromServer` after `duplicatePipelineStep` (161); `handleAddRoot`: `fetchPipelineById` after `addPipelineRoot` (63-64); `handleRemoveRoot`: `fetchPipelineById` + `syncStepsFromServer` after `removePipelineRoot` (85-87); `handleToggleStepEnabled` (115-120) sets local state only: safe |
| usePipelineStepMutations | `handleRemoveStep`: `syncStepsFromServer` in the `deletePipelineStep` `.then` (77-88) |
| usePipelineRunAndSaveActions | run / dry run: `refreshRunHistoryAfterRun()` + `refreshVisibleOutputPreviews(id)` after `submitPipelineRun(...).unwrap()` (74-76, 87-89); `handleSave` (navigate to `/pipelines`, no id) is safe |

Task 1.1 re-derives this on the worktree from BOTH `post-await.sh` (literal `dispatch(` lines) AND a search for calls
to dispatching helpers after an `await`/`.then` (`syncStepsFromServer`, `refreshRunHistoryAfterRun`,
`refreshVisibleOutputPreviews`, `settleSaved`, `loadRunHistoryWhenTruncated`, `onStepsSettled`, `onOutputsSettled`)
plus direct service calls, across every file in `features/pipelines/hooks/`. It commits `post-await-sites.md` here
with every hit and its disposition: gated (this change), safe (local state of an unmounted component, toast-only,
dispatch-before-await; `mountedRef` alone is NOT a safe disposition inside the eight hooks, only outside them), or out of scope (follow-up candidate: `usePipelineDraftCreate.ts:70`
flush, `usePipelineShapeInstantiation.ts:83-103` loop, `usePipelineRunStream.ts` SSE terminal handler with its
teardown-on-unmount stated). A gated-scope hit not in the table above stops the executor: escalate, do not widen.

## Goals / Non-Goals

**Goals:** in the eight hooks (every site in the table, `mountedRef`-guarded ones included), nothing that dispatches, calls a dispatching helper, or issues a service request runs
after an `await`/`.then` once the session epoch has changed since the work started.

**Non-Goals:** see proposal.md. `usePipelineDraftUndo.ts` is not edited. The epoch mechanism, middleware and
`EPOCH_EXEMPT_THUNKS` are unchanged. No behaviour change within one session.

## Decisions

**D1. Capture at the start, check after each await.** Each handler/effect captures `const startEpoch =
getSessionEpoch()` synchronously before its first await (or before the dispatch whose `.then` continues it), and
after each await/`.then` returns early when `getSessionEpoch() !== startEpoch`, before the next dispatch, dispatching
helper or service call. A single plain action may use `dispatchIfSameSession`. Rejected: `mountedRef` (two hooks
have none; the epoch is the mechanism HEL-1634 specified). No new export in `sessionEpoch.ts`; a hook may define a
local helper.

**D2. Checks sit outside `try` where a `catch` would issue requests.** `handleAddOutputViaAggregateTail`'s `catch`
rolls back with `deletePipelineStep(persistedStep.id)`, itself a request with A's step id. So its checks after
`createPipelineStep` and after `syncStepsFromServer` sit before the `try`, and the check after `createOutput` skips
only the two dispatches. A `createOutput` that REJECTS after sign-out lands in the `catch` directly, so the `catch` itself
calls `deletePipelineStep` only when `getSessionEpoch() === startEpoch` (the local `setSteps` filter and the rethrow stay).
`usePipelineDraftSave`'s catch gates only the `draftSaveRunSettled` dispatch; `finally`
(`draftSaveInFlightRef.current = false`, `setSaving`) always runs.

**D3. `handleAddOutputViaAggregateTail` on a changed session.** Its type is `Promise<Output>`. Before an Output
exists it throws `new Error("Signed out before the Output was created.")`. The caller chain
(`usePipelineDraftRouting.ts:243` -> `PipelineDetailDialogs.tsx:56` passes it through -> `OutputEditorSheet.tsx:274-283`
catches it as a failed save); the page is unmounting anyway. Once `createOutput` has resolved it returns the Output
without the follow-on dispatches. The executor verifies the caller's rejection handling and cites it in
`post-await-sites.md`.

**D4. Tests: one file per hook, the real store singleton, deferred responses.** Only `store/store.ts`'s `store`
wires `createSessionEpochMiddleware`, and no test helper does. Each test renders the hook (`renderHook`) inside a
`Provider` over that singleton, mocks the service module (`services/pipelineService` and the like) with deferred
promises, and starts the action. While it is in flight, it dispatches `clearAuth()`, then resolves. It asserts that
no follow-on service mock or dispatch happened. The
epoch is module-level and monotonic, so each test captures its own start value and needs no reset; `clearAuth`
resets slice state between tests. The hook stays mounted, so the test isolates the epoch check from `mountedRef`.
Each test is red on 98b8c40e9, the red run is committed before the fix (C6), and a mutation removing each new check
turns its test red.

**D5. Tidy.** Delete the second copy of "every cleared key names a registered hook or a known mechanism"
(`sessionResetGuard.test.ts:184-193`). Comment the `as { status: string }` casts at `recentVisitsListeners.ts:75-76`
(each slice has `status`; the generic `K` index does not narrow). Split `sessionStateAllowlist.ts` into
`sessionStorageAllowlist.ts` (`StorageKeyEntry`, `STORAGE_KEYS_KEPT`, `STORAGE_KEYS_CLEARED_BY_HOOK`) and
`sessionModuleStateAllowlist.ts` (`MODULE_STATE_NOT_USER_DATA`), with byte-identical contents, deleting the original and updating
the guard test's import. Check how the guard's file scan treats the allowlist today and treat both new files the
same, so guard results are unchanged.

## Risks / Trade-offs

- [A test is green for the wrong reason (middleware drop, unmount)] -> red run on current code plus a mutation per
  check are required evidence.
- [The split changes what the guard scans] -> guard pass counts before and after recorded; HEL-1634's guard mutation
  tests still pass.
- [Skipped `onStepsSettled` leaves a mounted page "pending"] -> only reachable after sign-out; accepted.
- [D3's throw after `createPipelineStep`, and a `createOutput` rejection after sign-out, skip the catch's
  `deletePipelineStep` rollback, leaving an orphaned aggregate tail on A's pipeline server-side] -> deliberate: the rollback is itself a request with A's step id under
  B's cookie (and would be refused); A sees and can delete the tail on next sign-in.

## Planner Notes

- Scope of eight hooks is the owner's ruling (`fold-in-all-8`), not self-approved.
- Self-approved: performing the optional allowlist split (only consumer is the guard test).
- Out-of-scope direct-service sites are recorded for follow-up triage at Delivery.
