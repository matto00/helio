## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD b16bfa1b3a74905eefc0208a01793efa047909c5. The planning artifacts are untracked files under the change dir. I did a read-only review: I started no backend, created no DB and used no MCP tools.

### What I verified (with evidence)

**design.md Context claims, each re-read in source:**
- **Table-wide thin under the purging backend's policy.** True. The `PARTITION BY output_id, age_class, floor(epoch / bucket_secs)` DELETE over all of `output_snapshot_history` is at `OutputHistoryRepository.scala:133-150`. The `pg_try_advisory_xact_lock` guard and `LockBusy` are at :154-158.
- **Retention service behavior.** True. `nextDue = AtomicReference(None)` is at `OutputHistoryRetentionService.scala:42`, so the first tick passes. The claim stores `now + purgeInterval` (:105). Busy-and-not-failed gives `CAS(claimed, now + lockRetry)` (:74-76). A failure keeps the full interval. Busy can come from either the history part or the payload part.
- **lockRetry default and cap.** True. `OutputHistoryRetentionConfig.scala:66-69`: default 120 s, capped at the interval. With `OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400` and an interval of 1440 min, the effective retry is 1440 min.
- **Tick ordering.** True. The actor sends `Tick` at setup (`PipelineSchedulerActor.scala:30`). The next Tick is armed only on `TickCompleted` (:50-55). `PipelineSchedulerService.tick()` zips `historyWork` (:99-106). The only caller of the retention service is this tick (grep shows Main:290 wiring and PipelineSchedulerService:101). The actor is spawned at Main:304, before `HttpServer.start` at :316.
- **Shared lock in the own-run payload trim.** True. `NodePayloadHistoryRepository.scala:117` uses `pg_try_advisory_xact_lock_shared(PurgeAdvisoryLockKey)`.
- **Free tier gets no payloads.** True. `allowsPayloads` is at `PayloadHistoryConfig.scala:11`, and the header documents free = 0.
- **`.env` and build settings.** True. `.env` holds `DATABASE_URL=jdbc:postgresql://localhost:5432/helio?user=matt&password=`. `build.sbt:124` has `Compile / run / envVars ++= loadDotEnv`, and :100 has `run / fork := true`.
- **Harness.** True. `verify.ts:368-431` has HISTORY_RUNS=30, a 6-minute budget, and the thinning error at :428. `package.json` has no pg dependency, and `tsx` is already a devDependency.

**Round-1 change requests, checked for real resolution:**
- **CR1: resolved.** D1 now gives the true mechanism: own runs take the shared lock, and today's safety rests on two latent facts. D3's env list and D2 add `OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400`. The spec wording now covers "lock-retry window". Task 2.4 requires HEL-1343 in the README. With retry capped to 1440 min, a busy or failed first pass cannot re-arm a pass inside the run (code path verified above).
- **CR2: resolved.** D2 now anchors on COMPLETED, explains why claim-time `now` is not enough, rejects INFO logs (a 0-delete pass logs nothing; verified at :61), and states that a busy or failed pass cannot cause a second pass. It requires a proven second-tick observable. Residual issue: see CR2 below.
- **CR3: resolved.** D6 green now requires dense history on S throughout, plus B's "deleted N" line with N > 0 timestamped inside the green window. Red now requires the same attribution. Constraint C1 records this.
- **CR4: resolved.**
  - (a) SIGINT/SIGTERM handlers and a ledger written before or at creation.
  - (b) PID printed before the health wait.
  - (c) uploads go under the OS temp dir.
  - (d) createdb, dropdb and psql run via child_process, with no pg dependency.
  - (e) dropdb runs only after the PID is confirmed gone, and FORCE is not used.

**The four questions:**
- **Q (other backends).** Sound. A backend connected to `helio` cannot DELETE rows in `helio_verify_<hex>`. Postgres advisory-lock keys are per-database, so a sibling cannot cause LockBusy there. Even if it could, the retry is 1440 min.
- **Q (own passes).** Sound. Exactly one pass, the startup one. The harness must wait for it to complete.
- **Q (D6).** Sound. The red is an accelerated model of the real hazard on a private S, satisfying C2. The green shows a provably active purger on another DB, so it cannot be explained as "B was idle".
- **Q (teardown).** Exact DB name, PID and ids. Nothing is selected by pattern, and no pkill, pgrep or killall is used. Nothing is written under `~`, and no dependencies are added. Teardown has one gap, which is the CR1 below.

### Verdict: REFUTE

### Change Requests

1. **Specify how the isolated backend's PORT is chosen, and prove the answering server is the isolated JVM before any write.** D3 and D5 never say which port is used. They only say "fail fast if the port already answers". Sibling lanes bind backends on ports allocated upward from 8080 (`scripts/concertino/.concertino.env:6,15`), and those backends are connected to the SHARED DB. The pre-check happens before the JVM starts. Flyway on a fresh DB takes many seconds before `HttpServer.start` binds (Main:316). If a sibling binds the same port in that window, our JVM fails to bind, and the health wait succeeds against the sibling. D4's register, mint and the whole harness then write a user, PATs, fixtures and 30 runs to the shared `helio` DB. Teardown would "drop" a dedicated DB that never held them. That breaks D4's "Nothing is written to the shared dev DB" and leaves untracked residue. Required changes:
   - (a) Choose the port deterministically from a range no lane uses, or ask the OS for an ephemeral free port. State which, in D3.
   - (b) Health success counts only while the recorded PID is alive.
   - (c) Before minting the bootstrap PAT, confirm via `psql` against the recorded dedicated DB name that the just-registered user's row exists there. Abort with teardown if it does not.

   Add this to task 2.1, and make the interrupt and teardown proof (3.4) show it.
2. **Resolve the D2 fallback against the spec's SHALL.** The spec says "the harness SHALL start only after that startup pass has completed". D2 still allows "fall back to a justified bounded wait". A timed wait cannot prove completion, so design and spec contradict each other. A reliable observable exists. The tick's first query reads `pipeline_schedules` every tick (`PipelineScheduleRepository.scala:88-91`). On the fresh DB nothing else touches that table before the harness. So `pg_stat_user_tables.seq_scan + coalesce(idx_scan, 0)` for `pipeline_schedules` reaching 2 or more, read via `psql`, proves tick 2 started. Tick 2 cannot start until tick 1's `historyWork` completed. Stats lag only makes this check conservative. Either drop the fallback, which is preferred, or weaken the spec sentence to match. Note that D2's other example, "the retention logger at DEBUG", shows nothing for a completed 0-delete pass or for a not-due tick 2. `LOG_LEVEL` is env-driven in `logback.xml:2`. So that example only works with root DEBUG and some other per-tick line. Do not let it stand as the primary suggestion.

### Non-blocking notes

- `.env`'s `DATABASE_URL` carries the user in the QUERY string (`?user=matt&password=`), not in the authority. The parser for createdb, dropdb and psql must read the query params. The override `DATABASE_URL` for the dedicated DB must keep that query string.
- D3's `java -cp` launch should also pass `Compile / run / javaOptions` (`build.sbt:224-235`, the `--add-opens` flags). Runs use `InProcessExecutionBackend` (`PipelineRunService.scala:164`), so the harness probably will not break without them. But Main eagerly initialises a Spark local session (Main:193), and Java 21 without these flags makes that fail. Record the exported options next to the classpath.
- During the green, D6 runs A, B and the isolated JVM at once, which is 3 JVMs. The Risks line says "one pair at a time". Reword it, and keep everything under `nice -n 19`.
- dropdb can briefly race Postgres backend exit after the JVM dies. A short bounded retry on the exact name is fine, but still without FORCE.
- In tasks.md, 3.6 is listed before 3.4. This is cosmetic.
