## 1. Investigation (probe before fix — systematic-debugging)

- [x] 1.0 Check `PipelineRunRepositorySpec.scala:639-660`'s ("concurrent submissions for the
      same owner never exceed the concurrency cap") git/CI history for any past failure —
      cheapest available evidence, since it already forces MORE real concurrent contention
      (12 vs. 8 writers) with zero gate/polling machinery, and run it standalone once to
      confirm it currently passes. Verified by citing `git log` output and the standalone run
      result; a past or present failure here short-circuits straight to H2.
- [x] 1.1 Add temporary, test-only instrumentation (advisory-lock acquire/release timestamp,
      admission decision + observed non-terminal count, terminal-write timestamp relative to
      `gate.success(())`) inside `PipelineRunGuardIntegrationSpec.scala`'s own
      `GatedExecutionBackend` override and each submission's `Future` — no production
      `PipelineRunService`/`PipelineRunRepository` changes (design.md Decision 3's H1 branch)
      — verified by running the existing test once and confirming the new log lines appear.
- [x] 1.2 Run the existing "rejects more than maxConcurrent REAL concurrent submissions" test
      in a forced-small-pool repeated loop (3-4 workers, `nice -n 19` — never sized to the
      6c/12t host's core count) to reproduce the 4-of-8 over-admission deterministically
      enough to read the interleaving from the instrumentation log.
- [x] 1.3 From the captured log, determine and state explicitly which holds: H1 (test
      coordination lets a straggler decide after a freed slot), H2 (guard locking/transaction
      window), or both — verified by pointing to the specific log lines that confirm it.

## 2. Fix (branch per 1.3's confirmed root cause)

- [x] 2.1 If H1: replace `awaitQueuedCount`'s DB-poll coordination with a mechanism that
      proves every submission in the burst has reached a terminal admission decision before
      the gate is released (test-only — see design.md Decision 3), verified by the existing
      test passing reliably under the same forced-small-pool loop from 1.2 with zero
      over-admissions across the loop.
- [x] 2.2 If H1: verify and cite `PipelineRunRepositorySpec.scala:639-660` (task 1.0) as the
      guard's independent atomicity proof — it already covers the ticket's "prove the guard
      separately with a deterministic interleaving test" requirement with no gate/polling
      confounder. Only add a NEW guard-level test if 1.0/1.3 surfaced a gap this one doesn't
      cover (state explicitly what property is missing if so). Verified by the existing test
      passing standalone and being named in the PR/commit as the atomicity proof.
- [x] 2.3 N/A — H2 was not confirmed (1.3): across 200+30 forced-small-pool iterations, every
      over-admission traced to a straggler settling strictly AFTER `gate.success(())`, never to
      two decisions racing each other with an inconsistent count while the gate was held.
      `insertRunIfUnderConcurrencyCap` is unchanged (confirmed via `git diff` showing zero
      production-code changes in this delivery).
- [x] 2.4 Demonstrate that WHICHEVER test is being relied upon as the guard-atomicity proof —
      a newly-added interleaving test (2.3, or 2.2 if a gap was found), OR the pre-existing
      `PipelineRunRepositorySpec.scala:639-660` test cited under 2.2's "verify + cite" path —
      is failable by mutation (e.g. widen `maxConcurrent` by one, or drop the lock
      acquisition) — show the mutation turns THAT test red, then revert the mutation before
      commit. Required even when 2.2 concludes no new test is written — a test that has only
      ever passed is a true-positive check, not proof it can catch the guard defect it's
      relied on to rule out.

## 3. Tests

- [x] 3.1 Full existing `PipelineRunGuardIntegrationSpec` suite passes, verified by
      `sbt "testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec"`.
- [x] 3.2 Full backend test suite passes (no regression), verified by `sbt test`.
- [x] 3.3 The full instrumentation added in 1.1 is removed or reduced to a permanent,
      low-noise form before commit — verified by reading the diff for leftover debug logging.
