## Context

HEL-1634 built `frontend/src/shared/session/sessionEpoch.ts` (`getSessionEpoch`, `bumpSessionEpoch`,
`dispatchIfSameSession`); the epoch middleware (wired only in `store/store.ts`'s singleton) bumps it on `clearAuth`
and drops a thunk's settle actions when the epoch changed since its `pending`. HEL-1798 (archive
`2026-11-20-gate-pipeline-hooks-session-epoch/design.md`) gated eight hooks with the pattern "capture at start, check
after each await" (its D1), placed checks outside a `try` whose `catch` would issue requests (D2), and tested each
site against the real store singleton with deferred service mocks and a mid-flight `clearAuth()` (D4). This change
applies the same pattern to the four remaining sites (lines on de44f85fb, re-verified at Setup):

| Hook | Post-await work to gate |
| --- | --- |
| usePipelineDraftCreate | `createDraftIfComplete`: in the `createPipelineStep` `.then` (70-94), the edit flush `updatePipelineStep(persisted.id, latest.config)` (86) |
| usePipelineShapeInstantiation | `handleInstantiateShape`: the next `createPipelineStep` (83) / `createOutput` (103) after each await, and the `catch`'s `pushToast` (113) |
| usePipelineRunStream | `onTerminal` (39-81): `dispatch(resetRunScopedState())`, the per-Output `previewOutput` thunk dispatch, `refreshRunHistoryAfterRun()` |
| usePipelineDraftUndo | `undo` (43-67): after `undoPatchSet` — `dismissSavedToast()` (dispatches `dismissToast`), `getPipelineWithDefinition(id)`; after that — `adoptDefinition` (dispatches step/Output/root replacements), `fetchPipelineById` (57), `pushToast` |

Sign-out unmounts the pipeline page, so pure local React state/ref writes are harmless (HEL-1798's SAFE
disposition); the defect is dispatches (toasts included, since they land in the next user's store), dispatching
helpers and service requests.

Re-enumeration on de44f85fb (every non-test file in `features/pipelines/hooks/` with an `await`/`.then` and no
`getSessionEpoch`): beyond these four, `useDraftNodeCapabilities` (local state behind a `cancelled` flag),
`usePipelineStepCreation`/`usePipelineLaneStepCreation` (`applyCreated` is local `setSteps`; error toast in `catch`),
`usePipelinePreviewCache` (SAFE per HEL-1798), `usePipelineRunEvents` (the SSE transport; local state; it calls
`onTerminal`, gated here), `useStepPreviewFetch` (local state behind a request token), `useRunToUpdate` (toast, no
ids). None issues a request or an id-carrying dispatch after an await, so the scope stays at four (no escalation).
Toast-only `catch` sites in those hooks are noted in Non-Goals, consistent with HEL-1798.

## Goals / Non-Goals

**Goals:** at the four sites, no dispatch (toasts included), dispatching helper or service request runs after an
`await` (or in the stream's terminal callback) once the session epoch has changed since the work started. A tested,
mutation-checked same-session rollback in `handleAddOutputViaAggregateTail`. No behaviour change within one session.

**Non-Goals:** changing `shared/session/*` or the middleware; editing the eight HEL-1798 hooks' code; error-toast-only
`catch` paths in `usePipelineStepCreation`/`usePipelineLaneStepCreation`/`useRunToUpdate` (no ids, outside the
ticket's four); HEL-1807's draft evaluator files; HEL-1820's dependency bumps.

## Decisions

**D1. Capture at start, check after each await (HEL-1798 D1).** `const startEpoch = getSessionEpoch()` is taken
synchronously before the first await of each unit of work; after each await the code returns early when
`getSessionEpoch() !== startEpoch`, before the next dispatch, dispatching helper or service call. No new export in
`sessionEpoch.ts`.

- `usePipelineDraftCreate`: capture before `createPipelineStep`. The first statement of the `.then` returns when the
  epoch changed — nothing after it runs (no `applyCreated`, no flush). The `.catch` (local state and refs only) and
  `.finally` (`creatingDraftIdsRef.delete`) are unchanged. Rejected: gating only the flush — returning at the top is
  simpler and the remaining writes are to an unmounting page.
- `usePipelineShapeInstantiation`: capture at the start of `handleInstantiateShape`. After each `await
  createPipelineStep` and each `await createOutput`, `if (getSessionEpoch() !== startEpoch) return;` (a `return`
  inside `try` does not enter the `catch`). The `catch` returns before `pushToast` when the epoch changed (a
  rejection that arrives after sign-out must not toast the next user).
- `usePipelineRunStream`: the "work start" is the page's session. Capture once per mount
  (`useRef(getSessionEpoch())`; sign-out unmounts the page, so one page instance belongs to one session). `onTerminal`
  still calls `setSseActive(false)` (local), then returns before `resetRunScopedState`, the preview dispatch and
  `refreshRunHistoryAfterRun()` when the epoch changed. Rejected: capturing in `usePipelineRunEvents` (a generic
  transport, and the ticket names the handler); capturing on each `sseActive` false->true transition (needs an effect
  or render-time ref write for no behavioural gain, since a session change always remounts).
- `usePipelineDraftUndo`: capture at the start of `undo`. After `await undoPatchSet`, return before `undoneRef` /
  `dismissSavedToast` / `getPipelineWithDefinition` when the epoch changed; after `await getPipelineWithDefinition`,
  return before `adoptDefinition`, `draft.discard()`, `fetchPipelineById`, `pushToast`. The existing `mountedRef`
  check is kept. In the `catch`, `setNotice` is local state (unchanged).

**D2. Tests (HEL-1798 D4).** One new file per hook: `usePipelineDraftCreate.sessionEpoch.test.tsx`,
`usePipelineShapeInstantiation.sessionEpoch.test.tsx`, `usePipelineRunStream.sessionEpoch.test.tsx`,
`usePipelineDraftUndo.sessionEpoch.test.tsx`. Each renders the hook (staying mounted, to isolate the epoch check from
`mountedRef`/unmount), mocks the service module(s) with `deferred` promises from `sessionEpochTestKit.ts`, starts the
work, dispatches `clearAuth()` on the real `store` singleton while it is in flight (for the run stream: before
invoking the captured `onTerminal`), resolves, and asserts no follow-on service mock call and no dispatch of the
gated actions (a spied/jest-fn `dispatch` or `pushToast`, or `store.dispatch` spy). Each file also has one
same-session control test proving the asserted follow-on DOES happen without `clearAuth` (so a test cannot pass
because the work never reached the follow-on at all). Rejection paths covered where gated: shape `catch` toast after
sign-out. The undo test also asserts `getPipelineWithDefinition` is not requested when the session ends during
`undoPatchSet`.

**D3. Same-session rollback test.** Added to `usePipelineStepStructure.sessionEpoch.test.tsx` (as HEL-1798's
evaluator suggested): no `clearAuth`, `createPipelineStep` resolves `step-new`, the resync resolves, `createOutput`
rejects; assert `deletePipelineStep` was called with `"step-new"`, the local `setSteps` filter ran, and the
handler rejects. Mutations that must turn it red: the guard replaced with `if (false)`, and `===` inverted to `!==`.

**D4. Evidence.** Red run of the four new test files on unmodified hooks recorded before implementation
(`red-run/`, as `.txt`; if the pre-commit hook refuses a red commit, the red run is committed as evidence alongside
the tests and the PR says so). One mutation per new check (remove/neutralise it) turns the corresponding test red,
recorded in `mutation-runs/`. The rollback test is new coverage of existing code (green on arrival), so its proof is
the two D3 mutations, not a red run. HEL-1634 guard (`shared/session/sessionResetGuard.test.ts`) and
`e2e/hel1634-logout-user-switch.spec.ts` re-run green against the lane DB.

## Risks / Trade-offs

- [A test green for the wrong reason (middleware drop, unmount, work never reached)] -> red run on unmodified code,
  a same-session control per file, and a mutation per check.
- [Mount-time epoch in `usePipelineRunStream` is wrong if a page instance outlived a session] -> sign-out unmounts
  the pipeline page (`ProtectedRoute` -> `/login`); the test documents the assumption by keeping the hook mounted
  across `clearAuth`.
- [Skipping the shape loop after sign-out leaves A's pipeline partially shaped server-side] -> accepted: the
  remaining creates would run under B's cookie (refused) and A sees the partial shape on next sign-in, exactly as a
  mid-loop failure today.
- [Skipping an undo's reload after sign-out] -> the undo itself already succeeded server-side; nothing is lost.

## Planner Notes

- Scope is the ticket's four sites plus the rollback test; re-enumeration found no further id-carrying site.
- Self-approved: mount-time capture for the run stream (D1); gating the shape `catch` toast.
