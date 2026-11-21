## Evaluation Report — Cycle 2 (evaluation-2.md)

This report reviews HEAD `124350edb4dfcff9855f5d8039ac9b0016e4d3fb`. The cycle-2 delta over cycle 1's `cad8f1a6b` is two
commits:
- `e6171e930` is the red commit. It adds one test only.
- `124350edb` is the fix. It adds a catch-path gate, plus doc corrections.

The diff base is unchanged (`98b8c40e9`). Everything verified in evaluation-1.md still holds for the unchanged files.

**My cycle-1 miss.** Evaluation-1 said D2 was "implemented as designed" and that the rollback "cannot run under B's session".
That was true only for a sign-out before `createOutput` settles successfully. A `createOutput` that rejects after sign-out
fell straight into the `catch` and sent `deletePipelineStep(persistedStep.id)` with A's step id. skeptic-final-1 caught it. I
did not. The cycle-2 fix closes that path.

### Phase 1: Spec Review — PASS
Issues: none.

- The new gate keeps the AC ("starts no follow-on request carrying the previous user's ids") on the last ungated path in
  `handleAddOutputViaAggregateTail`.
- design.md D2 now describes the catch gate, and the Risks section covers the skipped rollback.
- D4's slice-state sentence was trimmed to match the tests. This was my cycle-1 suggestion 3.
- In `post-await-sites.md`, the `usePipelinePreviewCache.ts:27, 41` row moved to SAFE. This was my cycle-1 suggestion 1.
- Scope is unchanged. C1–C10 are honoured. C6 holds because the red commit precedes the fix.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Red check (independent).** I ran the test at `e6171e930` in a throwaway detached worktree. That commit changes only the
test file relative to `cad8f1a6b`, so the hook code is the cycle-1 code.
- The new test "does not send the rollback delete when createOutput rejects after sign-out" fails.
- It fails for the right reason: `expect(deletePipelineStep).not.toHaveBeenCalled()` received 1 call. It is not a crash.
- The other 3 tests in the file pass.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/red2-eval.txt`.

**Green.** At HEAD, all 18 sessionEpoch tests pass.

**Mutation (independent).**
- I removed the `if (getSessionEpoch() === startEpoch)` guard at `usePipelineStepStructure.ts:152`.
- Exactly the new test failed (1 failed, 3 passed).
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/mutation2-eval.txt`.
- This agrees with the executor's `mutation-runs/cycle2-rollback-catch-gate.txt`.

**Code.**
- The gate is a minimal one-liner.
- The local `setSteps` filter and the `throw err` still run on every path.
- Within one session the delete still runs, because the epoch is unchanged and the comparison reads `===`.
- There are no new imports, no new types and no dead code.

**Gates.** All were run fresh in WORKTREE_PATH:
- `npm run lint` exited 0.
- `npm run format:check` exited 0.
- `npm run typecheck` exited 0.
- `npm test` ran with `HELIO_JEST_MAX_WORKERS=3` and the lane DB env, and exited 0. Root: 71 suites, 621 tests. Frontend: 902
  suites, 10480 tests, which is +1 over cycle 1, the new test.
- `npm --prefix frontend run build` exited 0.

### Phase 3: UI Review — PASS
Issues: none.

The delta is a catch-path guard. It has no markup, styles or tokens.

**E2E.**
- Servers were started with `start-servers.sh` against `helio_hel1798`, with `ANTHROPIC_API_KEY` exported empty.
  `assert-phase.sh servers` passed.
- I ran the full `e2e/hel1634-logout-user-switch.spec.ts` with 2 workers. 1 passed, 0 failed, no rerun.
- The spec deleted its 2 throwaway users. The `users` count is 1 both before and after.
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/e2e-4.txt`.
- The cycle-1 run of the ten pipeline-page specs (69 tests) covers the rest. Their code paths are unchanged apart from this
  one catch.

**Teardown.**
- Servers were stopped with `stop-servers.sh` (`STOPPED ports=7230,10137`).
- Frontend node PID 3355120 and backend java PID 3354849 are confirmed gone.
- Nothing is listening on 7230 or 10137.
- No sbt or java process has its cwd in the worktree.
- The throwaway worktree was removed.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- **The same-session rollback is untested.** The positive path is "createOutput fails in the same session, so the orphaned
  tail is deleted".
  - I replaced the new guard with `if (false)`, so the delete never runs.
  - The whole `features/pipelines` jest suite still passed: 3284 of 3284.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/rollback-positive-probe.txt`.
  - This gap predates the change: no test asserted the rollback before HEL-1798 either. By reading, the guard is correct
    (`===`).
  - Suggestion: add one test to `usePipelineStepStructure.sessionEpoch.test.tsx`. With no `clearAuth`, a rejecting
    `createOutput` should lead to `expect(deletePipelineStep).toHaveBeenCalledWith("step-new")`. That would make an
    inverted or always-false guard detectable.
- `handleSave` still calls `navigate("/pipelines")` after a late `updatePipeline`. This carries over from cycle 1: no id is
  involved, it is outside the AC, and it is worth noting for follow-up triage.
