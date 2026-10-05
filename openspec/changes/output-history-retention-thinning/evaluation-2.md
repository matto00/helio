## Evaluation Report — Cycle 2 (evaluation-2.md)

**Review scope**
- Reviewed HEAD: `f8602b49e6e77f33e7ee2a79d14d09842b0f51cc`.
- Live-resolved base: `2f4956509d0e125414335d99fc44628f6d264cc2`.
- Cycle delta: `f79c079b..f8602b49`.
- The change is still backend-only.

### Phase 1: Spec Review — PASS

- **CR3 (planning artifacts) is resolved.**
  - design.md Decision 2 now describes the `<> ALL` fail-closed DELETE.
  - Decision 3's "exhaustive match" claim has been removed.
  - The Risks section describes the `pg_try_advisory_xact_lock` key "HEL1272". It covers the skip-not-wait behavior, the one-interval retry, and the bounded rollback gap.
  - The non-goals in proposal.md and design.md now say the interval gate is per-process, while the purge itself is serialized.
  - The `output-snapshot-history` delta spec adds the concurrency SHALL and two scenarios: lock-skip and unknown tier.
  - My own run of `npx openspec validate output-history-retention-thinning --strict` reports "Change 'output-history-retention-thinning' is valid".
- **Executor claims checked:**
  - `git diff 2f495650...f8602b49 -- model.scala PipelineSchedulerServiceSpec.scala` is empty. Both files are byte-identical to the base, and `UserTier.all` is gone.
- **Standing constraints:**
  - C1: no change to the privileged-spec harness. The only edit there is a test rename.
  - C2: the 40-day literals are unchanged.
- **Acceptance criteria:** AC1–AC4 are still met. Phase 2 has the evidence.

### Phase 2: Code Review — FAIL

**Gates (my own fresh run, in WORKTREE_PATH at f8602b49):**
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: **5879 tests, 410 suites, 0 failed, 0 aborted**, 461 s. `sbt --client shutdown` ran afterwards as its own call.
- **FirstRunRoutesSpec ran and passed. It did not time out.**
- `PipelineSchedulerHistoryRetentionSpec` ran. Both new repository tests ran and passed.
- `npm run check:scala-quality`: clean. There are no frontend changes, so frontend gates do not apply.

**Mutations (my own).** These ran in a throwaway detached worktree at f8602b49, one at a time. The worktree was then removed by exact path, and `git worktree list` confirmed it was gone.

| Mutation | Spec(s) | Result |
|---|---|---|
| NOT-IN DELETE dropped (`DBIO.sequence(named)`) | OutputHistoryRepositorySpec | RED: 3 cases, including the unknown-tier case (`0 was not equal to 1`) |
| Skip branch runs the purge anyway | OutputHistoryRepositorySpec | RED: lock-skip case (`2 was not equal to 0`). Cycle-1 CR2 is closed |
| Probe at the start of the following test, with the unknown-tier test passing: exactly 1 tier CHECK on `users`, a `'pro'` insert rejected, a `'beta'` insert accepted | OutputHistoryRepositorySpec | GREEN: the CHECK is restored on the success path |
| Same probe, with the unknown-tier test forced to fail (`shouldBe 99`) | OutputHistoryRepositorySpec | Only the forced case fails, and the probe passes: the `finally` restore runs on the failure path |
| `case object Pro extends UserTier` added in Scala only | ConfigSpec + RepositorySpec | GREEN, by design (see below) |

**CR1 (option a) is resolved.**
- `OutputHistoryRepository.scala:108-116` purges every tier not named in the map at the strictest cap. It uses `u.tier <> ALL (string_to_array(<bound csv>, ','))`, which is a bound parameter, so there is no injection risk.
- Null safety holds: `users.tier` is `NOT NULL` (V88:13), so `<> ALL` cannot silently skip a NULL tier.
- When the map is total, the extra DELETE only matches tiers the code does not know.

**The `Pro` mutation staying green is acceptable.**
- Nothing enumerates the tiers any more. A tier missing from the config map, whether a new Scala case object or a raw DB value, is age-purged at the strictest cap (fails closed).
- The dropped-CHECK test proves this at the DB level, which is where an unknown tier can actually appear.
- The remaining hand-written tier list is `OutputHistoryRetentionConfig.scala:29`, `Seq(Free, Beta, Owner)`. Forgetting a tier there now fails toward the 30-day cap, not toward unbounded retention. That is the intended direction.

**The dropped-CHECK test cannot leak into other specs.**
- `OutputHistoryRepositorySpec` starts its own `EmbeddedPostgres` in `beforeAll` (line 32), so no other suite uses that database.
- The spec does not mix in `ParallelTestExecution`.
- The build sets `Test / testForkedParallel := false`, so tests inside the suite run one at a time.
- `HEL924_TEST_GROUP_CONCURRENCY` controls concurrent forked JVMs, each with its own embedded databases. The shared dev DB is never touched.
- The restored constraint `CHECK (tier IN ('free','beta','owner'))` matches V88:13 exactly. I proved the restore on both paths with the probes above.

**The lock-skip test is sound.**
- A separate JDBC session takes the session-level `pg_advisory_lock(key)`.
- `thinAndPurge` then returns 0 and all 3 rows remain.
- After unlock it deletes 2. `holder.close()` in the `finally` releases the lock even if an assertion fails.

**Issue — the new `PipelineSchedulerHistoryRetentionSpec.scala` (226 lines) is a copy of the `PipelineSchedulerServiceSpec` harness, carrying dead code and unused imports.**
This file came from the cycle-1 non-blocking split suggestion, and the problems were introduced in this cycle:
- Unused imports:
  - `com.helio.domain.util.CronSchedule` (line 4)
  - `java.time.temporal.ChronoUnit` (line 28)
  - `spray.json.{JsObject, JsString}` (line 24)
  - a same-package self-import, `com.helio.services.pipelines.{PipelineRunService, PipelineSchedulerService}` (line 3)
  - Each of the first three names appears only once, on its import line.
- Dead machinery at lines 57-77: `HangEntry`, `hangingReads`, `readCount` and the hanging-read `FileSystem` branch.
  - No test registers a hanging path, so `hangingReads.get` always returns `None`.
  - `readCount` is never asserted.
  - `cleanDb` (lines 121-122) resets both anyway.
- The Scaladoc at lines 57-60 cites "the overlap-guard test" and "design.md Decision 8". Neither exists in this file or this change, so the comment is false here.
- `auditEventRepo` is stored in a field but only used to build `auditService`.
- Line 149 is a blank line with trailing whitespace, left behind by a removed insert.
- About 130 lines of embedded-PG, repository and seed harness are duplicated verbatim from `PipelineSchedulerServiceSpec`. That is a DRY regression compared with the cycle-1 single file.

Everything else passes:
- Readable, modular, type-safe.
- Errors are handled; the skip path now logs at DEBUG.
- Tests are meaningful, and every new path is covered by a mutation that turns red.
- No over-engineering.

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: FAIL

### Change Requests
1. **Clean up or undo the copied harness in `backend/src/test/scala/com/helio/services/pipelines/PipelineSchedulerHistoryRetentionSpec.scala`.** Pick one:
   - **(a) Preferred:** move the three HEL-1272 cases back into `PipelineSchedulerServiceSpec` and propose the split in the PR description instead, as CONTRIBUTING allows past ~400 lines.
   - **(b)** Keep the separate file, but extract the shared embedded-PG, repository and seed harness into a test-support trait that both specs mix in. Then drop what this file does not use:
     - the imports at lines 3, 4, 24 and 28;
     - `HangEntry`, `hangingReads`, `readCount` and the hanging branch of `fakeFileSystem` (a plain `Future.successful(bytes)` read is enough);
     - the false Scaladoc at lines 57-60;
     - the `auditEventRepo` field (make it a local);
     - the whitespace-only line 149.

   Whichever you pick, the three scheduler-failure cases must still go red under the cycle-1 recover-removal mutation.

### Non-blocking Suggestions
- `OutputHistoryRepository.scala:94`: the Scaladoc line is now about 150 characters. Re-wrap it to match the surrounding lines.
- `OutputHistoryRepository.scala:7`: `org.slf4j.LoggerFactory` sits after the `slick` import. Order it with the other third-party imports.
- `OutputHistoryRepositorySpec` unknown-tier test: the `finally` runs the cleanup DELETEs and the `ADD CONSTRAINT` in sequence. If a cleanup DELETE throws, the CHECK is not restored for the rest of this suite. It cannot leak beyond the suite, which owns its database. Nesting the restore in its own `try/finally` would make it unconditional.
