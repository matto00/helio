## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: d2b1033f81ff456041809131c8912e1575782698 (base 609e62b6d917243355a179fa8a26318c04898c27, resolved live).

### Phase 1: Spec Review — FAIL

- AC1 (seam that holds a sibling, captured at call start, reset in `resetSeams`): PASS. `binaryEntered`/`binarySettled`
  (HookBinaryRepo) and `nodeWriteFailed` (HookSnapshotRepo) are bound at call start and replaced in `resetSeams()`.
- AC2 (answer not before the sibling settles; then success with exactly one `succeeded`): PASS as written.
- AC3 (red by removing `settle(siblings)`): PASS. Independently reproduced (see Phase 2).
- AC4 / C1 ("orderings forced with promises, never sleeps"): FAIL. The test's "the sibling settled before the answer"
  assertion depends on thread scheduling, not on a promise (Change Request 1).
- AC5 (premise validated against the code): PASS. Verified `PipelineRunDeletedRecovery.recover` l.35-37 runs
  `settle(siblings)` before reading `won`, and `PipelineRunSucceededWrites` passes `binaryRefsUpsert` in `siblings`.
- Tasks: all marked done and matching the diff. No scope creep: only three test files and the change directory.
  `git diff 609e62b6d...HEAD -- backend/src/main` is empty (C2).
- C3: evidence.md cites this worktree's paths and executed counts. C4: honored. C5: honored for `nodeWriteFailed` and
  `binarySettled`. For `binaryEntered`, evidence.md documents why reverting its capture cannot be observed: it is completed
  synchronously at call start, so a live read and a captured read are the same instant. That reasoning is correct.
- `.openspec.yaml`: well-formed. It has three lines, `schema: spec-driven` / `created: 2026-10-14` / `skip_specs: true`,
  with no duplicated `schema`/`created` lines (checked with `cat -A`). It matches the archive convention, e.g.
  `archive/2026-10-10-pin-chat-cap-day-clock/.openspec.yaml`. The suspected duplication is not present.

### Phase 2: Code Review — FAIL

Gates I ran myself:
- `nice -n 19 sbt "testOnly ...LateFinisherRunSpec ...LateFinisherDeleteAfterWonSpec ...LateFinisherSeamIsolationSpec"`
  in this worktree: live run at 08:13:19-08:13:29, logback resource path
  `/home/matt/Development/helio/.claude/worktrees/task/guard-recovery-sibling-settle/HEL-1594/backend/target/out/...`,
  the new test and both new isolation tests listed by name, `Total number of tests run: 24`,
  `Tests: succeeded 24, failed 0`.
- `npm run check:scala-quality`: `clean (250 soft warning(s))`, exit 0. Touched files are under the 250-line soft budget
  (234/138/142). `check:openspec` clean. `check:repo-integrity`, `check:test-temp-dir-hygiene`, `format:check` exit 0.
- Scope: the orchestrator's binding operational rule limited sbt to `testOnly` over the late-finisher specs, so a full
  `sbt testFull` was not run.

Independent mutation proof (D4/AC3). I ran it in a throwaway `git worktree add --detach` copy of d2b1033f8 under the
session scratchpad, not in the delivery worktree. That way no delivery code was ever modified, and the copy has been
removed:
- Replaced `settle(siblings).flatMap(_ =>` with `Future.unit.flatMap(_ =>` in `PipelineRunDeletedRecovery.scala`.
  `testOnly LateFinisherDeleteAfterWonSpec` was RED: `should not answer before that sibling settles ... *** FAILED ***`
  / `Expected exception java.util.concurrent.TimeoutException to be thrown, but no exception was thrown
  (LateFinisherDeleteAfterWonSpec.scala:94)` / `Total number of tests run: 7` / `Tests: succeeded 6, failed 1`. The
  run was live at 08:13:53, with the logback path inside the throwaway copy's own `backend/target`.
- Reverted with `git checkout -- backend/src/main` in the copy, after which `git diff --stat backend/src/main` was empty.
  In the delivery worktree, `git status --short` is empty and `git diff backend/src/main` is empty. HEAD is unchanged
  at d2b1033f8.

Issues:
1. **Scheduling-dependent assertion: a flake, and a C1/AC4 violation.**
   - `LateFinisherDeleteAfterWonSpec.scala:88` records the observation with
     `answer.onComplete(_ => settledWhenAnswered.set(settled.isCompleted))`, and `:97` waits on `answer` itself with
     `Await.result(answer, 60.seconds)`. `:98` then asserts `settledWhenAnswered.get shouldBe true`.
   - In Scala 2.13.15, `Await` registers its wake-up latch with `onComplete(l)(ExecutionContext.parasitic)`
     (`scala/concurrent/impl/Promise.scala:238`). Callbacks fire newest-first (`concatCallbacks`/`submitWithValue`,
     l.323-338). So the waiting test thread is released synchronously on the completing thread, before the test's
     `onComplete` has even been handed to `ExecutionContext.global`. The test thread can therefore read the
     `AtomicBoolean` while it is still at its initial `false`, and fail on correct production code.
   - Probes:
     - (a) A standalone stdlib reproduction with the same shape (answer completed on a `global` worker, `onComplete` on
       `global`, then `Await.result` and an immediate flag read) saw the flag unset in 121 of 5000 iterations.
     - (b) In the throwaway copy with production unmodified, I added only a 200 ms delay inside that `onComplete`
       callback, standing in for a loaded `global` pool. The test went RED at `false was not equal to true
       (LateFinisherDeleteAfterWonSpec.scala:98)`, `Tests: succeeded 6, failed 1`.
     - (c) The fix in Change Request 1, under the same 200 ms delay, went GREEN: `Tests: succeeded 7, failed 0`.
   - The executor's 5/5 green repeats do not rule this out. The race window is narrow on an idle machine.

No other findings:
- DRY: `submitWith` is correctly refactored onto `submitAsync`, so there is one wiring.
- `nodeWriteFailed` uses `andThen { case Failure(_) => ... }`, which re-fails the original error unchanged.
- `binarySettled` uses `andThen`, which correctly orders it before the sibling's own completion.
- No new `Thread.sleep`/`eventually`. The sleeps grep-matched in `LateFinisherRunSpec.scala`/`LateFinisherSpecBase.scala`
  are pre-existing.
- No dead imports. `Failure`, `TimeoutException`, `AtomicBoolean`, `Await` and `DurationInt` are all used.

### Phase 3: UI Review — N/A

Test-only backend change. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files are touched.

### Overall: FAIL

### Change Requests

1. In `backend/src/test/scala/com/helio/services/pipelines/LateFinisherDeleteAfterWonSpec.scala:88`, replace
   `answer.onComplete(_ => settledWhenAnswered.set(settled.isCompleted))` with
   `val observed = answer.andThen { case _ => settledWhenAnswered.set(settled.isCompleted) }`. At `:97`, await `observed`
   instead of `answer`: `Await.result(observed, 60.seconds).isRight shouldBe true`.
   - Keep the step-4 absence check (`:94-95`) on `answer`, unchanged.
   - `andThen`'s future completes only after its callback has run, so the flag is set before the test thread reads it.
     The ordering then comes from a future instead of a scheduling race.
   - I verified this exact change green under a 200 ms callback delay. The pre-change code is red under the same delay.
   - Update `evidence.md` with a fresh green run of the three specs (this worktree's paths and executed counts).
   - Re-run the D2 mutation to show it is still red, at the step-4 assertion.

### Non-blocking Suggestions

- Even after the fix, the `settledWhenAnswered` assertion reads `settled` slightly after the answer completed. On its
  own it is a weak mutation detector, because a mutant whose sibling settles a moment later could still read `true`.
  The step-4 absence check is what actually guards D2. Saying so in the test comment would stop a future reader from
  relying on line 98 alone.
- The `binaryEntered` isolation assertion `binaryEntered.isCompleted shouldBe false` after `resetSeams()` cannot fail by
  construction. evidence.md already says this. A one-line test comment stating it would keep the test from reading as
  a reversion-proof guard.
