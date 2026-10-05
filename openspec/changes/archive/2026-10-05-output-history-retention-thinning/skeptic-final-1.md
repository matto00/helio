## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `699944233ddef6a8df27e5e4946295378b3f51e5`. The base was resolved live by `resolve-review-base.sh` to `2f4956509d0e125414335d99fc44628f6d264cc2`, which is the merge-base with origin/main.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY` for this branch. The worktree is clean apart from the evaluator's untracked `evaluation-3.md`.

- **D4 thinning and the 40-day survivors (AC1, C2):** I derived the survivors by hand, independently of the spec's docstring.
  - Setup: `now` is UTC midnight 2026-06-30. Points sit at `now - 30k min`, for k = 1..1920.
  - Recent window (k < 48, 5-minute buckets): all 47 points survive.
  - Mid window (48 <= k < 336, hour buckets):
    - Each hour holds a :00 point (even k) and a :30 point (odd k), and the :30 point is the newer one.
    - k=48 is alone in its class partition because its hour-partner k=47 is in the recent class.
    - Survivors: {48} plus the odd k from 49 to 335, which is 145 points.
  - Old window (k >= 336, day buckets):
    - k=336 is alone in its class.
    - Each remaining day keeps its newest point, k = 337+48i, which gives 33 points for the owner (i = 0..32, ending at k=1873).
    - The free tier's 30-day cutoff is a strict `<`, so k=1440 escapes the age purge but is thinned by k=1393. That gives the free tier 23 points (i = 0..22).
  - Extras: the 8m and 7m points share a bucket and 7m wins; 3m is alone. That adds 2 points.
  - Totals: owner 47+145+34+2 = **228**, free 47+145+24+2 = **218**.
  - These match the exact sets the spec asserts (`OutputHistoryRetentionServiceSpec.scala`, `survivors(oO) shouldBe expectedKs(...)`). The expectations are literal and not recomputed from the SQL.
- **Second tick within the interval is a no-op, and the test is not vacuous (AC2):**
  - New thinnable points (+11m and +12m, same bucket) are inserted *after* the first purge.
  - The purge at +59m returns `None` and the count stays at 2. The purge at +60m returns `Some(1)`.
  - The CAS gate in `OutputHistoryRetentionService.claim` runs before the repo call. The "8 concurrent callers -> exactly 1 runs" test pins it.
- **Purge failure is logged and never fails the tick (AC3):**
  - `PipelineSchedulerServiceSpec` has three cases: a failed future, a synchronous throw, and the service itself throwing.
  - Each case asserts that `tick()` completes and that the due schedule still fires. The two repo-failure cases also assert, through a ListAppender, that an ERROR log containing "Output history retention purge failed" was written.
  - I read the layering: the service's `Future.delegate` and `.recover`, plus the scheduler's `Future.delegate` and `.recover`. It is consistent with the evaluator's mutation table, which I did not re-run.
- **Privileged pool and the two-role topology (AC4, C1):** `OutputHistoryRetentionPrivilegedSpec`.
  - The app pool is `helio_app_test`, and the spec asserts `rolbypassrls = false`. The privileged pool is `helio_privileged`, and the spec asserts `rolbypassrls = true`.
  - No grant to `helio_privileged` is issued in the spec (C1). The privileged pool's access comes from migrations, for example V115's explicit GRANT.
  - The purge must return `Some(2)`. This is non-vacuous: if the work ran on the app pool with no user context, forced RLS would make it delete 0. And because the service maps a failure to `None`, a missing grant would also go red.
- **Tier comes from `pipelines.owner_id`:**
  - Both DELETEs join `h.pipeline_id = p.id AND p.owner_id = u.id`.
  - The shared-pipeline test inserts a free-tier grantee's Output on an owner-tier pipeline; a 40-day point survives. History rows cannot orphan: `outputs.pipeline_id` has an FK to `pipelines` with ON DELETE CASCADE (V94:208), and the history row cascades with its output.
- **Unknown tier fails closed at the strictest cap:**
  - The `unnamed` DELETE uses `u.tier <> ALL(string_to_array(named, ','))` with `min(caps)`. `users.tier` is NOT NULL (V88:13), so a NULL can never slip past `<> ALL`.
  - The test drops the CHECK on embedded PG to create a real `pro` tier, and restores it in a nested `finally`. It deletes exactly the 40-day point.
  - A separate test confirms that the shortest of several caps is the one applied.
- **`pg_try_advisory_xact_lock` skip path:**
  - The test holds a session-level `pg_advisory_lock` on the same key from another connection. Session and transaction advisory locks share one lock space and conflict.
  - While the lock is held, the pass returns 0 and keeps all 3 points. After unlock, it returns 2.
- **L1 repository change (minimal? any regression?):**
  - The diff is +40 lines, made up of three things: the join switch, the unnamed-tier DELETE, and the lock wrapper.
  - The thin SQL and every other method (`insertAction`, `listRecent`, nearest, earliest) are byte-identical to the base.
  - L1's guarantee "a tier missing from the map is never purged" was deliberately inverted, as the ticket asked. The spec delta `specs/output-snapshot-history/spec.md` MODIFIES that requirement, and the one renamed L1 test now passes a full cap map.
  - Every other L1 test is unchanged.
- **Parallel lanes:**
  - HEL-1278 has since merged to main (32571b01). I checked whether this branch conflicts with it:
    - `git merge-tree --write-tree origin/main HEAD` merges cleanly.
    - HEL-1278 touches none of this branch's files.
    - Its only use of `OutputHistoryRepository` is `listRecent` (AlertEvaluationService.scala:145), which is unchanged here.
  - `PipelineRunService` uses only `insertAction`, which is also unchanged.
  - `OutputRoutes`, `OutputService`, `PublicDashboardRoutes` and `AlertRuleService` are not touched by this branch.
- **CLAUDE.md compared with `OutputHistoryRetentionConfig.fromEnv`:**
  - All 9 names match.
  - Defaults match: 30/90/365 days, 24h, 5m, 7d, 60m, 24h, and a 60m interval.
  - The fallback rules match: per value, a non-numeric value or one below 1 falls back to the default; and if the recent window is not strictly shorter than the mid window, the whole policy falls back with a WARN.
- **Main.scala and PipelineSchedulerService.scala hunks:**
  - Main.scala: +5/-2, made up of an import, the construction, and one named argument.
  - PipelineSchedulerService.scala: +12/-2, made up of a nullable param (the existing productEventRollupService convention) and one zipped `historyWork`. Both hunks are minimal.
- **Gates, which I re-ran myself:**
  - Command: `nice -n 19 sbt "testOnly OutputHistoryRetentionServiceSpec OutputHistoryRetentionPrivilegedSpec OutputHistoryRetentionConfigSpec OutputHistoryRepositorySpec PipelineSchedulerServiceSpec RlsPrivilegedDmlSpec"`.
  - Result: **6 suites, 57 tests, 0 failed, 0 aborted**. The measured tick duration on the 40-day fixture was 20 ms.
  - I ran `sbt --client shutdown` afterwards as a separate call.
  - The full `testFull` run (5879 tests, FirstRunRoutesSpec passed with no timeout) is the evaluator's pasted output in evaluation-3.md. I did not re-run it.
- **UI:** none changed, so I skipped the design review.

### Verdict: CONFIRM

### Non-blocking notes
- **CLAUDE.md wording:** the "non-numeric or < 1 falls back" rule is written only on the `_FREE` row, and the BETA/OWNER rows inherit it through "As above". The 6 policy and interval rows do not state it, although the code applies it to all 9 variables. Invalid combinations such as a bucket wider than its window are not validated; they are harmless but unchecked.
- **HEL-1278 interaction (L8's concern, not this leaf's):** thinning leaves only the newest point per 5-minute bucket. A "previous point" baseline therefore means "previous surviving point" once a purge has run inside the same 5 minutes.
- **Thin-query cost:** the thin DELETE scans the whole history table with a window function once an hour. 20 ms at about 3.8k rows; no prod-scale measurement.
- **Spec length:** `PipelineSchedulerServiceSpec.scala` is now 410 lines. The PR body should propose splitting it, as files-modified.md already notes.
- **Branch drift:** the branch is one commit behind main (HEL-1278). It merges cleanly with no shared files.
