## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 30eacce4f891cd4f997655d461181fc6a9b581fb (base 54f2943cd20b0ac26f3f1581bb1fcf15bfb8a8fc, resolved live via resolve-review-base.sh). V125 is still free on origin/main (tail V124 at d6aef6c46), and nothing on main since the base touches the changed files.

### Independent evidence (fresh, evaluator-run)

- **Red-first, re-run by me on unmodified main.** I made a throwaway detached worktree at 54f2943cd and copied in the HEAD repro spec. The only edits were the ones main cannot compile: I dropped the `autoRunMaxRetries` ctor arg, the `debounceState` (guard_retry_count) assertions and case (d). Every `debounceRowExists` and `runCount` assertion was kept. Result: (a), (b) and (c) all FAILED at `debounceRowExists(pid) shouldBe true` (lines 188, 226, 260), which is the dropped-row reason. Transcript: `.concertino/runs/HEL-1504/evidence/eval-red-on-main.txt`. This matches the executor's `red-repro.txt` (3 failed, same assertion, same reason).
- **My own mutations on HEAD, in the same scratch worktree:**
  - The active-run `unclaim` changed to `releaseClaim` turns (a) red (line 197, row gone).
  - The D2a pre-check forced off (`if (false)`) turns (c) red at `rateCount(owner) shouldBe 0` (line 273: `1 was not equal to 0`). This proves the pre-check is what saves the rate slot.
  - Cases (b) and (d) stayed green under these mutations, as expected.
  - Transcript: `evidence/eval-mutation.txt`. The scratch worktree was removed afterwards (`git worktree list` is clean, and the delivery worktree is unchanged at 30eacce4f).
- **Targeted run in WORKTREE_PATH:** DatasetWriteAutoRunDroppedFireSpec, AutoRunGuardNoRetryStormSpec, DatasetWriteAutoRunEndToEndSpec and PipelineAutoRunDebounceRepositorySpec gave 26/26 passed, and `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` appears in the output.
- **`nice -n 19 sbt testFull` in WORKTREE_PATH:** 7179 succeeded, 0 failed, 4 canceled, with the `[hel1468-guard]` summary failed=0 aborted=0 unreadable=0 (`evidence/eval-testfull.txt`).
- **Other checks:** `npm run check:scala-quality` is clean (soft warnings only, no inline FQN). `prettier --check` on CLAUDE.md and the change-dir markdown is clean.

### Phase 1: Spec Review — FAIL

- AC (a)/(b)/(c) red-first with a deterministic clock seam and no sleeps: PASS (verified independently above).
- AC "exactly one eventual run, no HEL-505 bypass, bounded": PASS.
  - Every fire still goes through `PipelineRunService.submit`. D2a can only withhold a submit, never admit one.
  - Retries are capped by `guard_retry_count < maxRetries` and spaced at least `max(1, Retry-After)` apart.
- Owner rulings Q1/Q2/Q3 are honoured.
- Constraints C1/C2/C3 are honoured (C2: new specs use `VerifiedEmbeddedPostgres.start`, guard line present, no FQNs, no sleeps).
- Old-drop assertions: AutoRunGuardNoRetryStormSpec and DatasetWriteAutoRunEndToEndSpec are rewritten. No other test asserts row absence after an active-run or guard-reject fire (grep over backend/src/test, and testFull is green).
- Spec delta (dataset-write-auto-run) matches the behaviour.
- **Issue 1, planning artifacts do not reflect the implemented wiring.** The executor did not thread `autoRunMaxRetries` (or the guard config) through `Main` → `PipelineSchedulerService` → firer. Instead it made `PipelineRunService.guardConfig` a public `val`, which the firer reads (`PipelineAutoRunDebounceFirer.scala:30`). These artifacts still describe the threading:
  - `tasks.md:15` (2.2, ticked [x])
  - `design.md:91` (D4, "threaded into `PipelineSchedulerService` and then `PipelineAutoRunDebounceFirer` as a constructor param (default 10 for fixtures)")
  - `proposal.md:22` (Impact: "`PipelineSchedulerService` wiring, the `Main` wiring")

  `PipelineSchedulerService` and `Main` are not in the diff. The deviation itself is acceptable, and arguably better (see Phase 2). The archived artifacts must still say what shipped.
- **Issue 2, a live spec scenario now knowingly diverges.** `openspec/specs/pipeline-run-guard/spec.md:88-93` ("An auto-run submission is subject to the same guards as a manual one") says each fire "is rejected exactly as a manual API submission would be". Under D2a, a cap-blocked auto-run is withheld before `submit`, so it does not consume a rate slot as a manual rejection does. design.md acknowledges this ("stricter than the guard ... the PR body states it"). A PR body is not the living spec, so the archived spec would contradict the shipped behaviour.

### Phase 2: Code Review — PASS

- **D2a predicate is shared, not copied.** `ownerInFlightRealRunsQuery` (`PipelineRunRepository.scala:163`) is the single definition, used by `countAndInsertAction` (`:190`, which is used by both the owner path `:154` and the grantee path `:226`) and by `countOwnerInFlightRealRunsInternal` (`:173-174`).
  - `countOwnerInFlightRealRunsInternal` runs under `withSystemContext` (privileged, transactional), so it sees at least as many rows as the RLS-scoped authoritative count. That makes it strictly conservative.
  - It compares against the same `guardConfig.maxConcurrent` the executor uses (`PipelineRunExecutor.scala:153/156`).
  - On a pre-check failure it recovers to 0 and defers to `submit`. That is fail-to-authoritative, not fail-open.
- **Token and race semantics.**
  - `unclaim` is `UPDATE ... SET claimed_at = NULL WHERE pipeline_id AND claimed_at = token`. It leaves `fire_at` and `guard_retry_count` alone, and a mismatched token makes it a no-op.
  - `rearmAfterGuardRejection` runs its compare-on-token UPDATE (guarded by `guard_retry_count < max`), then a compare-on-token DELETE, in ONE transaction (`DbContext.withSystemContext` = `.transactionally`).
  - If a fresh write takes over, both match zero rows, which gives `Superseded`.
  - `upsertDebounce` resets `guard_retry_count = 0` and `claimed_at = NULL`. With `maxRetries = 0` the first rejection deletes the row and returns `Exhausted(0)`.
  - All of this is covered by repository-spec cases, including token mismatch.
- **Executor deviation (public `val guardConfig`).** Acceptable.
  - It is an immutable case class, exposed read-only.
  - The firer reads the exact instance the guard enforces, so the cap, the advisory Retry-After and the retry allowance cannot drift apart. That is a stronger guarantee than threading a second copy through the scheduler, and it matches design.md:76's own requirement ("threaded from the same `PipelineRunGuardConfig` instance `PipelineRunService` uses").
  - No CONTRIBUTING.md rule is violated. The only problem is the stale artifacts (Phase 1, Issue 1).
- **Behaviour against D5.** Ordering is preserved (active run, then verdict, then pre-check, then submit). Verdict denial, success, other `Left`s and unexpected failures still `releaseClaim`.
- **CLAUDE.md row.** Present, accurate against the code (default 10, `<0`/non-numeric falls back, 0 means drop on the first rejection, spacing, fresh-write reset, D2a no rate slot, active-run wait is not a retry), and prettier-clean.
- **Tests.** Meaningful and mutation-sensitive (verified above). No dead code, no TODOs.

### Phase 3: UI Review — N/A

Backend and docs only. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file is changed.

### Overall: FAIL

### Change Requests
1. Update the planning artifacts to the shipped wiring:
   - `tasks.md:15` (2.2): replace "thread through `Main` → `PipelineSchedulerService` → `PipelineAutoRunDebounceFirer`" with "the firer reads it from `PipelineRunService.guardConfig` (now a public val), the same instance the guard enforces".
   - `design.md:91` (D4): replace the "threaded into `PipelineSchedulerService` ... as a constructor param (default 10 for fixtures)" sentence the same way. The fixture default now comes from the `PipelineRunGuardConfig` case-class default.
   - `proposal.md:22` (Impact): drop "`PipelineSchedulerService` wiring, the `Main` wiring". List `PipelineRunGuardConfig`, `PipelineRunService` (guardConfig exposed) and `PipelineRunRepository` (shared in-flight query) instead.
2. Add a `specs/pipeline-run-guard/spec.md` delta to this change that MODIFIES the "An auto-run submission is subject to the same guards as a manual one" scenario (live spec lines 88-93). It should state that an auto-run that would hit the owner's concurrency cap may be withheld before submission by a read-only pre-check of the same count, consuming no rate slot. This is never looser than the guard, and the run-count bound is unchanged. That way the archived spec matches D2a instead of only the PR body.

### Non-blocking Suggestions
- `DatasetWriteAutoRunEndToEndSpec`'s rewritten case asserts `claimed_at = NULL` and `guard_retry_count = 1`, but not that `fire_at` moved by the Retry-After (design.md D6 CR3 asked for that). Cases (b) and (c), and AutoRunGuardNoRetryStormSpec, do cover it, so this is optional.
- `PipelineRunRepository.scala` is 641 lines (it was already over the ~400 split threshold before this change, +17 here). Consider noting a split in the PR description, per CONTRIBUTING.md.
