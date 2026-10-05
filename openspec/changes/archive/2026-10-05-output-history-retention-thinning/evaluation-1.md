## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `f79c079b7bf58dcf02ca1982c6c377969f6a8567`. The diff base was resolved live with
`resolve-review-base.sh` to `2f4956509d0e125414335d99fc44628f6d264cc2`. The diff is backend-only:
`backend/**`, `CLAUDE.md` and the change dir. There are no `frontend/**`, `schemas/**`, `openspec/specs/**`
or `ApiRoutes.scala` changes.

### Phase 1: Spec Review — FAIL

- AC1 (40-day fake-Clock, exact survivors): addressed (`OutputHistoryRetentionServiceSpec`). **C2 check:** I derived
  the survivors myself from the thin SQL's strict-`<` class edges (`OutputHistoryRepository.scala:126-131`) and its
  epoch-aligned buckets, with `now` = 2026-06-30T00:00Z:
  - Recent class (k=1..47): 47 survivors. Extras 23:52/23:53 share [23:50,23:55), 23:53 wins, and 23:57 is alone, so +2.
  - Hour class (k=48..335): k=48 (06-29 00:00) is alone in its class for its hour, and k=335 (06-23 00:30) is alone
    because k=336 is class 2. The 49/50 … 333/334 pairs keep the odd k. That gives 1 + 144 = 145.
  - Day class: k=336 is alone, and each earlier day keeps its 23:30 point, k=337+48i. Owner keeps i=0..32 (k=1873 =
    05-21 23:30; k=1920 = 05-21 00:00), so 34. Free cutoff is `< now-30d`, so k≤1440 survive the purge. The 05-31 day
    holds k=1393..1440, where 1393 is newest and 1440 is thinned, so i=0..22, giving 24.
  - Owner 47+2+145+34 = **228**. Free 47+2+145+24 = **218**. Both match the spec's literals.
  - The log cross-checks this: 3400 deleted = 2×1923 − 228 − 218.
  - The derivation does not depend on whether a point exactly on a class edge counts in the lower or the upper class.
    The literal sets use only ranges, not a re-implemented bucket algorithm. C2 is honored.
- AC2 (second tick within the hour is a no-op): addressed, and not vacuous. New thinnable points are seeded between
  ticks: +59m gives `None` with both rows kept, and +60m gives `Some(1)`.
- AC3 (purge failure logged, tick never fails): addressed. The failed-future and synchronous-throw cases go through
  `PipelineSchedulerService.tick()` with a due schedule that still fires, and a `ListAppender` captures the ERROR log.
  An outer-recover case is also present.
- AC4 (privileged pool, two-role topology, non-BYPASSRLS check): addressed. `rolbypassrls` is false on
  `helio_app_test` and true on `helio_privileged`. **C1 check:** the harness grants only to `helio_app_test`
  (`OutputHistoryRetentionPrivilegedSpec.scala:49-52`). Nothing is re-granted to `helio_privileged`. C1 is honored.
- Tasks 1.1–2.9 are all marked done and match the diff.
- Scope: no creep. No migration, API or frontend changes.
- **Issue — the planning artifacts do not describe the advisory lock.** The executor added
  `pg_try_advisory_xact_lock` with skip-on-contention (`OutputHistoryRepository.scala:136-145`). This adopts the
  skeptic's design non-blocking note 1. design.md does not mention it anywhere: Decisions 1/4 and Risks
  ("two instances may each purge in the same hour; both are idempotent") still describe the version without the lock.
  proposal.md's non-goal "Cross-instance coordination of the hourly gate" is now partly contradicted. The
  `output-snapshot-history` delta spec says nothing about the skip either. See Change Request 3.

### Phase 2: Code Review — FAIL

**Gates (my own fresh run, in WORKTREE_PATH at f79c079b):**
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: **5878 tests, 409 suites, 0 failed, 0 aborted**, 458 s.
  After it finished, `sbt --client shutdown` ran as its own call.
- **FirstRunRoutesSpec did not time out.** It ran and passed in this run.
- The new specs ran in this run. The measured tick on the 40-day fixture took 15 ms (the executor recorded 20 ms).
- `npm run check:scala-quality`: clean. There are no inline-FQN violations, only informational size warnings.
- No frontend files changed, so the frontend gates do not apply.

**Mutation re-runs (my own).** These ran in a throwaway detached worktree at f79c079b, since this role may not modify
code. That worktree was removed afterwards with `git worktree remove --force`, and `git worktree list` confirmed it
was gone.

| Mutation | Spec | Result |
|---|---|---|
| Join reverted to `outputs o … o.owner_id` | OutputHistoryRepositorySpec | RED (shared-pipeline case) |
| Fallback removed (`maxAgeByTier.toSeq`) | OutputHistoryRepositorySpec | RED (2 fallback cases) |
| Interval gate removed (`claim` → `true`) | OutputHistoryRetentionServiceSpec | RED (no-op + concurrent cases) |
| Purge routed through app pool (`withUserContext(<zero uuid>)`) | OutputHistoryRetentionPrivilegedSpec | RED (`Some(0) was not equal to Some(2)`) |
| Lock always "held" (`case true => DBIO.successful(0)`) | ServiceSpec + PrivilegedSpec | RED (40-day, no-op, privileged), so the lock does **not** make those specs vacuous |
| Lock skip branch removed (`case false =>` runs the purge anyway) | all 4 touched specs | **GREEN, so the skip path is unexercised** |
| New `case object Pro extends UserTier` without updating `UserTier.all` | OutputHistoryRetentionConfigSpec | **GREEN.** Compile succeeded with only `match may not be exhaustive` warnings, including at `OutputHistoryRetentionConfig.scala:22` |

The first two parallel invocations of the fallback and app-pool mutations shared the scratch worktree concurrently. I
discarded those results and re-ran both one after the other. The table shows the sequential results.

**Advisory lock review:**
- Key collision: `0x48454C31323732L` ("HEL1272") is distinct from every existing key in `backend/src/main`:
  - `PipelineCycleValidator.AdvisoryLockKey = 72901101L`
  - `ProductEventRepository.AdvisoryLockKey = 0x48454C31323038L` ("HEL1208")
  - `PipelineRunRepository`'s `hashtext(...)`, which is int4-ranged (|x| < 2^31). The new key is about 2.0e16, so it
    cannot collide with that range.
  - No migration takes an advisory lock.
- Skip semantics: correct and acceptable. The in-process CAS gate already rules out same-process overlap, so a skip
  only happens when another instance holds the lock, and that instance is doing the same idempotent global pass. The
  skipping instance then waits one full interval, which is harmless because the holder did the work. The only bad
  case is the holder rolling back: then nobody purges for up to one interval, a bounded delay with no data risk.
- Not vacuous: confirmed by the lock-always-held mutation above.
- Untested: confirmed by the lock-skip-removed mutation above. See Change Request 2.

**Checklist issues:**
- **`UserTier.all` is a second hand-written list, with no exhaustive tie** (`model.scala:189-191`).
  - The pin test (`OutputHistoryRetentionConfigSpec.scala:56-61`) compares `all` against a third hand list
    (`Seq("free","beta","owner")`), not against the DB `users.tier` CHECK its Scaladoc claims to be pinned to.
  - Exhaustiveness is only a warning in this build (no fatal-warnings flag). So the comment at
    `OutputHistoryRetentionConfig.scala:20` ("exhaustive match: a new tier fails to compile here") is false.
  - Consequence, proven by the `Pro` mutation: a new tier missing from `all` is absent from both `maxAgeByTier` and the
    repo's `effectiveCaps`. Its history is then **never age-purged**, which is the exact fail-open Decision 2 exists to
    close.
  - The skeptic's design note 2 asked for exactly this not to be hand-written twice. See Change Request 1.
- **Untested new branch**: the `case false => DBIO.successful(0)` skip at `OutputHistoryRepository.scala:140`. See
  Change Request 2.
- Everything else passes: DRY, readability, modularity, type safety, security (no injection; all SQL values are
  bound), error handling (the service recovers and logs; `Future.delegate` plus an outer recover in the scheduler),
  meaningful tests, no dead code or TODOs, no over-engineering. Main/scheduler hunks are minimal, as the ticket's
  parallel-lane note asked.

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: FAIL

### Change Requests
1. **Make the tier enumeration total by mechanism, not a hand list.**
   - Problem: `model.scala:191` `UserTier.all = Seq(Free, Beta, Owner)` is pinned only by a hard-coded test list.
   - Do one of the following:
     - (a) Preferred, removes the dependency on enumerating tiers in Scala: in `OutputHistoryRepository.thinAndPurge`,
       add one extra age-purge DELETE for `u.tier NOT IN (<tiers named in effectiveCaps>)` at the strictest cap. A tier
       the code does not know then fails closed by construction.
     - (b) Change the `UserTier.all` pin test to read the legal values from the migrated DB. For example, query
       `pg_get_constraintdef` for the `users.tier` CHECK on an embedded Postgres, or `SELECT DISTINCT` over a
       generated insert probe. Assert they equal `UserTier.all.map(UserTier.asString)`, so a migration adding a tier
       goes red until `all` is updated.
   - In either case, correct the false comment at `OutputHistoryRetentionConfig.scala:20`. A non-exhaustive match only
     warns in this build; it does not fail compilation. Also correct the Scaladoc at `model.scala:189-190`, which
     claims a pin to the CHECK that the test does not perform.
   - Verify with the mutation that adds `case object Pro extends UserTier` without touching `all`. It must go red.
2. **Test the advisory-lock skip path.** Add a case to `OutputHistoryRepositorySpec` or `OutputHistoryRetentionServiceSpec`:
   - Hold the purge key on a separate session, e.g. `SELECT pg_advisory_lock(<key>)` on a dedicated JDBC connection.
     Expose the key as `private[persistence]` or package-visible, or assert the literal.
   - Call `thinAndPurge` with thinnable rows present. Assert it returns 0 and the rows remain.
   - Release the lock, call again, and assert the rows are thinned.
   - Verify with the mutation `case false => purgeByAge.flatMap(a => thin.map(_ + a))`. It must go red; it is green
     today.
3. **Bring the planning artifacts in line with the lock.**
   - Add a design.md Decision, or amend Decision 4 and the Risks bullet, describing `pg_try_advisory_xact_lock` on
     key "HEL1272": what it prevents (concurrent multi-row DELETE deadlock across instances), the skip-not-wait
     semantics, and that the skipping instance waits one interval because its gate is already claimed.
   - Amend proposal.md's non-goal "Cross-instance coordination of the hourly gate" to say the gate stays per-process
     while the purge itself is serialised.
   - Add a sentence and scenario to the `output-snapshot-history` delta spec: concurrent thin/purge passes do not run
     simultaneously; a pass that finds another in progress deletes nothing.

### Non-blocking Suggestions
- `OutputHistoryRetentionPrivilegedSpec.scala:96` is named "the same thin DELETE runs on the app pool", but it issues
  `DELETE … WHERE output_id = $oid`, not the thin statement. The check is still sound, because RLS blocks a superset
  of the thin's rows. Rename the test to match what it does, e.g. "delete nothing from history on the app pool with
  no user context".
- `PipelineSchedulerServiceSpec.scala` grew to 411 lines, past CONTRIBUTING's ~400 threshold. Per CONTRIBUTING,
  propose a split in the PR description, e.g. moving the HEL-1272 cases into a `PipelineSchedulerHistoryRetentionSpec`.
- `PipelineSchedulerServiceSpec.scala:9-14`: the new imports sit in the middle of the existing block, and
  `com.helio.infrastructure.persistence.pipelines` is now imported on two lines. Merge them into the existing
  `pipelines.{...}` import.
- On a skip, `thinAndPurge` returns 0 indistinguishably from "nothing to delete". A DEBUG log on the skip branch would
  make cross-instance behaviour observable in prod logs.
