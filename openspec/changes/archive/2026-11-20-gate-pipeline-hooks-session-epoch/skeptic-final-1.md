## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `cad8f1a6b5a10ba0adae1b8cbc7ba082d337d287` against the live-resolved base `98b8c40e9`
(`resolve-review-base.sh`, exit 0). Note: `origin/main` has since advanced to `763c69f6f` (HEL-1792, which touches only
`usePipelineDraftUndo.ts`, out of scope here), so the branch needs a rebase before merge.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/pipeline-hooks-session-check/HEL-1798`.
- **Diff read in full** for all eight hooks, `recentVisitsListeners.ts`, the allowlist split and the guard test.
- **Only `clearAuth` bumps the epoch** (`sessionEpochMiddleware.ts:37` is the only caller of `bumpSessionEpoch`). Every
  new check compares against an epoch captured at the start, so within one session each check is a no-op. I found no
  behaviour change inside a single session.
- **Red run is genuine:** `red-run/red-run.txt` shows 17/17 failing on the red commit `b017acee6`, which adds only tests.
- **Every new check is killed by a mutation.** The executor's `mutation-runs/` cover one check per hook. I mutated each of
  the remaining 11 checks myself, using a scratch copy of the hook wired in through `moduleNameMapper`. The worktree was not
  touched, and a no-op control copy passed 2/2. Each mutation turned exactly its own test red:
  RunAndSave:77, :92; StepStructure:129, :131; DraftSave:167, :178 (catch gate), :237 (reload); PageLoad:80, :149;
  RootAndToggle:90, :166. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/skeptic-final/mut/summary.txt`.
  No test passes for the wrong reason (the mounted hook isolates the epoch check from `mountedRef`, as D4 intends).
- **Allowlist split:** each entry in `sessionStorageAllowlist.ts` (107 lines) and `sessionModuleStateAllowlist.ts`
  (444 lines) is byte-identical to the original `sessionStateAllowlist.ts` (547 lines). A sorted line diff shows only
  the reworded header doc comments. Both new files export `readonly` arrays, which the guard's walker skips as frozen.
  `sessionEpochTestKit.ts` is scanned but declares no module state. The guard passes (8 tests, which is base 9 minus the one
  removed duplicate). I confirmed that duplicate is an exact copy at base lines 173-182 / 184-193.
- **Casts commented** at `recentVisitsListeners.ts:75`.
- **Gates, re-run fresh:** `npm run typecheck` exit 0. `eslint --max-warnings=0` on the changed dirs exit 0. Prettier is
  clean. Jest `shared/session|sessionEpoch|recentVisits` gives 15 suites, 88/88 passed.
- **HEL-1634 e2e:** I started servers on the lane DB (`start-servers.sh` READY, `assert-phase.sh servers` PASS) and ran
  `e2e/hel1634-logout-user-switch.spec.ts` plus `e2e/hel1631-draft-mode.spec.ts` with 2 workers. Result: 11 passed, exit 0,
  and the spec itself deleted its 12 throwaway users. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/skeptic-final/e2e-skeptic.txt`.
  I stopped the servers with `stop-servers.sh` (`STOPPED ports=7230,10137`; both ports confirmed free).
- **Catch blocks audited**, in all eight hooks:
  - DraftSave's catch gates its one dispatch.
  - The catches in DuplicateStep, RemoveStep, the run/dry-run handlers and AddRoot/RemoveRoot only set local state or
    show a toast.
  - **One catch does issue a request carrying A's id** (see below).

### Verdict: REFUTE

### Change Requests

1. **`usePipelineStepStructure.ts:147-153`: the rollback in the `catch` of `handleAddOutputViaAggregateTail` still sends
   `deletePipelineStep(persistedStep.id)` after sign-out.** This happens when `createOutput` *rejects* after `clearAuth`.
   The rejection skips the post-`createOutput` check at :139, because that check is only on the success path. Control then
   lands in the catch, which calls `void deletePipelineStep(persistedStep.id)` with user A's step id under the next
   session. This breaks the extended AC1 ("starts no follow-on request carrying the previous user's ids"). It also
   contradicts the code's own comment at :112-113 and design D2, which both say the rollback is kept from running under a
   new session.
   - This path is plausible. A sign-out that revokes A's session server-side while `createOutput` is in flight makes that
     request fail, so the response that arrives after sign-out is a rejection.
   - Reproduced 3/3 with a scratch probe: resolve `createPipelineStep` and `getPipelineSteps`, hold `createOutput`,
     `clearAuth()`, then reject `createOutput`. Observed `deletePipelineStep calls after sign-out: [["step-A1"]]`.
     Probe: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/skeptic-final/rollback.probe.tsx`.
     Output: `/home/matt/Development/helio/.concertino/runs/HEL-1798/evidence/.concertino/scratch/HEL-1798/skeptic-final/rollback-probe-output.txt`.
   - Fix: in the catch, call `deletePipelineStep` only when `getSessionEpoch() === startEpoch`. The local `setSteps`
     filter and the `throw err` can stay.
   - Add a fourth case to `usePipelineStepStructure.sessionEpoch.test.tsx`: `createOutput` rejects after sign-out ->
     `deletePipelineStep` is not called. Show it red before the fix, plus a mutation run of the new gate.
   - Update design.md D2 and its orphaned-tail risk bullet to cover this rejection path. The outcome is the same as the
     accepted pre-try case: an orphan tail that A can delete later.

### Non-blocking notes

- `handleRemoveRoot` still shows its success toast ("Source removed: N steps, M Outputs removed.") when the epoch changed.
  The toast carries no ids and this was not changed, but it can appear after sign-out.
- `usePipelineDraftSave`: if the epoch changes, the early return after `saveDraft` leaves `sseActive` true. This is
  harmless in practice because sign-out unmounts the page.
- The executor's `mutation-runs/` cover one check per hook, not "each new check" as D4 states. My 11 extra mutations close
  that gap, but a future round should mutate every check.
- No server PIDs to report: `start-servers.sh` / `stop-servers.sh` printed only READY and STOPPED lines with ports, no
  PIDs. Ports 7230 and 10137 were confirmed free afterwards.
