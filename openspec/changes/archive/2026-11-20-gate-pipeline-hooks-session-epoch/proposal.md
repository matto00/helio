## Why

HEL-1634 drops async work that crosses a sign-out, but eight pipeline page hooks still continue after an `await`
with no session check. A late continuation can start a new request carrying the previous user's pipeline, step or
Output id under the next user's session, or write that id into the freshly reset `pipelines` state (HEL-1798; scope
extended to eight hooks by owner ruling `fold-in-all-8`).

## What Changes

- `usePipelinePageLoad`, `usePipelineStepStructure`, `usePipelineDraftSave`, `useOutputImmediateActions`,
  `useRunHistory`, `usePipelineRootAndToggleActions`, `usePipelineStepMutations` and `usePipelineRunAndSaveActions`
  capture the session epoch when their async work starts. Once it has changed, every dispatch, every dispatching
  helper call and every follow-on service request after an `await`/`.then` is skipped.
- A jest test per hook shows a response arriving after sign-out is not dispatched and starts no follow-on request;
  each is red on current code.
- HEL-1634 tidy: remove the duplicated test in `sessionResetGuard.test.ts`; comment the two casts in
  `recentVisitsListeners.ts`; split `sessionStateAllowlist.ts` (547 lines) into a storage-key allowlist and a
  module-state allowlist, behaviour-preserving.

## Capabilities

### New Capabilities

### Modified Capabilities
- `sign-out-client-state-reset`: the late-load requirement also forbids a late pipeline-page continuation from
  starting follow-on work (a request or a dispatch) that carries the previous user's ids.

## Impact

Frontend only: eight hooks under `frontend/src/features/pipelines/hooks/`, `frontend/src/shared/session/`
(allowlist split, guard test) and `frontend/src/features/commandPalette/state/recentVisitsListeners.ts`. No API,
schema or migration change.

## Non-goals

- `usePipelineDraftUndo` (owner ruling; sibling HEL-1792). Its post-await work is behind `mountedRef`, and sign-out
  unmounts the pipeline page (`ProtectedRoute`); only `dismissToast` (a toast id, no pipeline id) runs before it.
- Hooks outside the eight whose post-await work is local React state of a component sign-out unmounts
  (`usePipelineStepCreation`, `usePipelineLaneStepCreation`, `useStepPreviewFetch`, reorder/toggle in the eight).
- Direct service calls after an await in hooks outside the eight (`usePipelineDraftCreate`'s in-flight-edit flush,
  `usePipelineShapeInstantiation`'s step loop). They are listed in `post-await-sites.md` as follow-up candidates.
- Any change to the epoch mechanism itself.
