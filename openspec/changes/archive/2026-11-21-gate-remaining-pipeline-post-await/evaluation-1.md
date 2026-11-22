## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 38491d9a032f3d3c15c7c6b28761f8d093b13d88 (base de44f85fb2b7779e3ceecdb54cfc095030d0f58a, resolved live).

### Phase 1: Spec Review — PASS
Issues: none.
- AC1 (a test fails first for each site): `red-run/four-files-unmodified-hooks.txt` shows 7 failed / 5 passed across the four new files on unmodified hooks. Every sign-out test is red there and every same-session control is green. `red-run/shape-output-loop-unmodified-hook.txt` adds the Output-loop test (4 failed / 3 passed).
- AC2 (the rollback test turns red under mutation): I re-ran it myself, see Phase 2.
- AC3 (the HEL-1634 guard and e2e still pass): I re-ran both, see Phase 2.
- design.md D1 is implemented as written at all four sites:
  - `usePipelineDraftCreate.ts:63/74` returns at the top of `.then`.
  - `usePipelineShapeInstantiation.ts:98/113/117` checks after each step create, after each Output create, and before the toast in `catch`.
  - `usePipelineRunStream.ts:39/45` captures the epoch at mount and checks it after `setSseActive(false)`.
  - `usePipelineDraftUndo.ts:50/53/57` checks after each of the two awaits. The `mountedRef` check is kept.
- C10 scope is respected. There are no edits to `shared/session/*`, the HEL-1807 files or package files. The spec delta matches the implemented behaviour, and the tasks are all checked and match the code.
- C12 is honoured: draft create swaps the config in flight, undo seeds `savedToastRef`, and the run-stream control seeds an Output and asserts on `dispatch` (3 calls) plus `refreshRunHistoryAfterRun`.

### Phase 2: Code Review — FAIL (committed evidence defect only; the code and tests are sound)
I ran the gates myself in WORKTREE_PATH. They were all green:
- `npm run lint`: 0.
- `npm run format:check`: 0.
- `npm --prefix frontend run typecheck`: 0.
- `npm --prefix frontend run build`: 0.
- `npm test`: root 621/621, frontend 10539/10539, 915 suites. This includes `sessionResetGuard.test.ts`.
- e2e `hel1634-logout-user-switch.spec.ts` against helio_hel1810 with 2 workers: 1 passed.

I ran these mutations myself. Each one was restored with `git checkout`, and `git status` was clean afterwards. Logs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1810/eval-mut-*.txt`.
- Removing ONLY the shape `catch` check (`usePipelineShapeInstantiation.ts:117`) turned exactly "does not toast a rejection that arrives after sign-out" red (1 failed / 6 passed). The dedicated catch-toast test DOES prove its check on its own.
- Rollback guard `usePipelineStepStructure.ts:152` replaced with `if (false)`: "rollback in the same session" went red (1 failed / 4 passed).
- Run-stream check removed: "dispatches and refreshes nothing ..." went red.
- Undo check after `getPipelineWithDefinition` removed: "adopts, refetches and toasts nothing ..." went red.

The executor's committed records for the other mutations (draft create, undo after `undoPatchSet`, shape after Output, rollback inverted) are consistent with this and with the code.

Issue: `mutation-runs/shape-catch.txt` does not record a catch mutation. Its header reads `replace occurrence 0`, and occurrence 0 of `if (getSessionEpoch() !== startEpoch) return;` is the step-create check at line 98, not the `catch` at line 117. Its body is the same failure set as `mutation-runs/shape-after-step.txt`: the same two tests red and the same "5 total". That means it also ran against an earlier 5-test version of the test file, not the committed 7-test one.

This is the cause of the executor's note that "the catch mutation did not turn the catch-toast test red". The note is wrong. Under a real catch-only mutation the test goes red, as shown above. But the committed artifact still claims a mutation that was never performed, and the PR will cite it. `shape-after-step.txt` is also stale: it ran against the 5-test file, but its conclusion still holds.

Code-quality review: no findings.
- Imports are relative and match the sibling hooks.
- No inline FQNs, no `any`, no dead code and no TODO.
- Each new comment explains why the code exists.
- The pattern is the same as HEL-1798's D1/D2. The `return` inside `try` is placed so it does not enter `catch`, and the `catch` check comes before any toast.

### Phase 3: UI Review — PASS
There is no visual or DOM change; only hook control flow changed. The sign-out flow was exercised end to end by the HEL-1634 e2e I ran against this lane's servers (start-servers.sh on 7242/10149, then stopped with stop-servers.sh). There were no layout or breakpoint surfaces to check, and I did not use the shared Playwright MCP browser.

### Overall: FAIL

### Change Requests
1. Re-record `openspec/changes/gate-remaining-pipeline-post-await/mutation-runs/shape-catch.txt` against the committed 7-test file, using a mutation that removes ONLY the `if (getSessionEpoch() !== startEpoch) return;` inside `catch` at `usePipelineShapeInstantiation.ts:117` (occurrence 2, not 0). Expected result: only "does not toast a rejection that arrives after sign-out" is red, 1 failed / 6 passed. Re-record `mutation-runs/shape-after-step.txt` against the same 7-test file. Fix the mutation script's occurrence index so each label matches the line it mutates. Correct any PR or handoff text that says the catch-toast test does not prove its check. No source or test change is needed.

### Non-blocking Suggestions
- The draft-create sign-out test could also assert `applyCreated` is not called, since the check returns before it. This is optional because the flush assertion already pins the check.
