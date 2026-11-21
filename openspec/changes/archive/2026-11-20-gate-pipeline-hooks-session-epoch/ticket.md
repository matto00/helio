# HEL-1798: Pipeline page hooks: drop late responses after sign-out (session check), plus HEL-1634 tidy

## Description

origin_kind: followup
origin_ticket: HEL-1634 (PR matto00/helio#1198, merged as fef01cda9). The owner chose to file this as a standalone ticket.

HEL-1634 added one central reset when a user signs out, and a session check that drops responses arriving after
sign-out. Three pipeline page hooks were left out on purpose, because HEL-1661 was editing the pipeline page at the
time. They still dispatch after an `await` without checking whether the user signed out in between:

* `frontend/src/features/pipelines/hooks/usePipelinePageLoad.ts` (around lines 67-77 and 142-146)
* `frontend/src/features/pipelines/hooks/usePipelineStepStructure.ts` (around lines 132-136)
* `frontend/src/features/pipelines/hooks/usePipelineDraftSave.ts` (lines 160 and 169; now 164 and 173)

The risk is low. One of user A's requests would have to stay in flight through user B's whole sign-in, and the
server answers by B's cookie, so none of A's data is returned. The worst case is A's pipeline id landing in B's
freshly reset `pipelines` state. That still breaks HEL-1634's rule that no request carries A's ids.

## Do

* Use HEL-1634's `dispatchIfSameSession` (or the session check) in those three hooks.
* Tidy what HEL-1634 left:
  * Remove the duplicated test in `sessionResetGuard.test.ts` (around lines 173 and 184).
  * Comment the casts at `recentVisitsListeners.ts:75-76`.
  * Consider splitting `sessionStateAllowlist.ts` (547 lines).

## Acceptance criteria

- [ ] A test for each hook: a response that arrives after sign-out is not dispatched. The test fails on the current code.
- [ ] HEL-1634's guard and e2e still pass.

## Scope added at Planning (owner ruling `fold-in-all-8`, 2026-11-20)

Re-enumerating every post-await continuation in `features/pipelines/hooks` (and the round-1 design skeptic) found
five more hooks with the same defect: a continuation after an `await` that starts a request or dispatch carrying
the previous user's pipeline, step or Output id. The owner ruled (escalation `HEL-1798-1795236040329-e90e42`,
answer `fold-in-all-8`, recorded via `concertino answer`) to fix all eight hooks in this ticket and to leave
`usePipelineDraftUndo.ts` alone (sibling HEL-1792). The first acceptance criterion applies to all eight hooks:

* `usePipelinePageLoad.ts`, `usePipelineStepStructure.ts`, `usePipelineDraftSave.ts` (named above)
* `useOutputImmediateActions.ts` (`previewOutput` after `await createOutput`)
* `useRunHistory.ts` (`fetchPipelineRunHistory` in a `fetchPipelineById` `.then`)
* `usePipelineRootAndToggleActions.ts` (`handleDuplicateStep`: `syncStepsFromServer` after `await duplicatePipelineStep`)
* `usePipelineStepMutations.ts` (`handleRemoveStep`: `syncStepsFromServer` in a `deletePipelineStep` `.then`)
* `usePipelineRunAndSaveActions.ts` (run / dry run: run-history and Output-preview refreshes after `submitPipelineRun`)

## Acceptance criteria (as extended)

- [ ] A test for each of the eight hooks: a response that arrives after sign-out is not dispatched, and starts no
  follow-on request carrying the previous user's ids. The test fails on the current code.
- [ ] HEL-1634's guard and e2e still pass.
- [ ] The HEL-1634 tidy items above are done (duplicate test removed, casts commented, allowlist split).

Start only after HEL-1661 merges (it has: 16a6042d6).
