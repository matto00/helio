## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 5d383ba4e2711f22a6da0cc131b5eac8fb27e661 against the live-resolved base de44f85fb2b7779e3ceecdb54cfc095030d0f58a (resolve-review-base.sh, exit 0). Scratch logs are in /home/matt/Development/helio/.concertino/scratch/HEL-1810/skeptic-*.txt.

### What I verified (with evidence)
- **Diff scope** (`git diff BASE...HEAD -- frontend/src`): four hooks gated, four new test files, and one rollback test added to `usePipelineStepStructure.sessionEpoch.test.tsx`. There are no edits to `shared/session/*` or to unrelated files. The rest is openspec artifacts and evidence.
- **AC1, the sites are gated** (I read the full hook bodies):
  - `usePipelineDraftCreate.ts:63/74`: the epoch is captured before `createPipelineStep`, and `.then` returns first thing, so neither `applyCreated` nor the `updatePipelineStep` flush runs.
  - `usePipelineShapeInstantiation.ts:76/98/113/117`: the epoch is checked after each step create and each Output create, and before the `catch` toast.
  - `usePipelineRunStream.ts:39/45`: the epoch is captured at mount. `onTerminal` still calls `setSseActive(false)`, then returns before the reset, the preview dispatch and the run-history refresh.
  - `usePipelineDraftUndo.ts:50/53/57`: the epoch is checked after `undoPatchSet` and after `getPipelineWithDefinition`.
  - The ungated paths are local React state and refs only (draft-create `.catch`/`.finally`, and the undo `catch`'s `setNotice` behind `mountedRef`). That matches HEL-1798's SAFE disposition. Direct service calls are gated, not only `dispatch`.
- **AC1, failing first** (my own red run): I checked out the four hooks at de44f85fb and ran the four new test files. All 8 sign-out tests failed and the 6 same-session controls passed ("8 failed, 6 passed, 14 total"). I restored the hooks with `git checkout HEAD`.
- **Mutation proof per check** (I ran each mutation myself and restored each with git checkout):
  - Draft-create guard removed: 1 failed / 1 passed.
  - Shape check after a step create removed: 2 failed / 5 passed.
  - Shape check after an Output create removed: 1 failed / 6 passed.
  - Shape `catch` check removed: 1 failed / 6 passed.
  - Run-stream check removed: 1 failed / 1 passed.
  - Undo check after `undoPatchSet` removed: 1 failed / 2 passed.
  - Undo check after `getPipelineWithDefinition` removed: 1 failed / 2 passed.
- **AC2, rollback**:
  - Replacing `usePipelineStepStructure.ts:152` with `if (false)` failed exactly "handleAddOutputViaAggregateTail rollback in the same session › removes the orphaned step locally and deletes it when createOutput rejects" (1 failed / 4 passed).
  - Inverting `===` to `!==` failed 2 tests: the new rollback test plus the existing sign-out test.
- **AC3**:
  - All `sessionEpoch.test` suites plus `shared/session/sessionResetGuard.test.ts` pass: 13 suites, 41 tests.
  - `e2e/hel1634-logout-user-switch.spec.ts` passes against helio_hel1810. Servers were started with start-servers.sh on 7242/10149 (assert-phase PASS), the e2e ran with 2 workers ("1 passed (12.9s)"), and the servers were stopped with stop-servers.sh (STOPPED).
- **Static checks**: `tsc --noEmit` exit 0; `eslint --max-warnings=0` on the hooks dir exit 0; `prettier --check` exit 0.
- **Artifacts**: the spec delta describes the implemented behaviour, tasks.md has no unchecked boxes, and design.md D1 to D4 match the code.
- **Worktree state**: clean after my runs. The only untracked file is the evaluator's evaluation-2.md, which was there before I started.
- **UI**: there is no visual or DOM change (hook control flow only), so I did no screenshot review and did not use the shared browser.

### Verdict: CONFIRM

### Non-blocking notes
- `usePipelineRunStream` captures the epoch once per mount. This is correct only while sign-out unmounts the pipeline page. That assumption is documented in a comment and in design.md, but no test enforces it.
- The draft-create sign-out test could also assert that `applyCreated` is not called (carried from the evaluator).
