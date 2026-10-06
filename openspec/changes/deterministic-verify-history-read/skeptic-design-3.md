## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD b16bfa1b3a74905eefc0208a01793efa047909c5. The planning artifacts are untracked files in the change dir. This was a read-only review. I started no backend, created no DB, never touched the shared DB, and used no MCP tools.

### What I verified (with evidence)

**Round-2 change requests, checked for real resolution:**
- **CR1 (port/identity): resolved in design.**
  - D3 now takes an OS-assigned ephemeral port by binding `127.0.0.1:0`.
  - Health success counts only while the recorded PID is alive.
  - A `psql` check confirms the registered user row exists in the dedicated DB before the PAT is minted. If it does not, the run aborts and tears down.
  - Task 2.1 carries all three.
  - One residual gap: round 2 also asked for task 3.4 to show the identity check. 3.4 does not mention it. See CR2.
- **CR2 (D2 timed fallback): resolved as a wording matter.** The fallback is gone ("no timed fallback"). A timeout now means teardown and a non-zero exit. The INFO-log observable is explicitly rejected.
  - However, the observable that replaced the fallback has a soundness hole. See CR1.
- **Round-1 CRs 1–4:** still resolved. The D1 HEL-1343 text, the `OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400` cap (`OutputHistoryRetentionConfig.scala:66-69`), the C1 attribution and the D5 signal/ledger/no-FORCE text are all present.

**New D2/D3 factual claims, re-read in source:**
- **The tick reads `pipeline_schedules` first.** True. `PipelineSchedulerService.tick()` calls `listTickCandidatesInternal` (`PipelineScheduleRepository.scala:88-91`, system context).
- **Tick N+1 is armed only on `TickCompleted`.** True. The actor sends `Tick` at setup, and the next tick is armed only on `TickCompleted` (`PipelineSchedulerActor.scala:29-55`). `tick()` zips five futures that include `historyWork` (`PipelineSchedulerService.scala` ~:76-106). Main spawns the actor at :304, before `HttpServer.start` at :316.
- **"Nothing else touches that table on the fresh DB before the harness starts": NOT established.**
  - Flyway runs inside the same backend, on the same fresh DB, before health (`Database.scala:17-28`).
  - `V62__pipeline_schedules.sql` creates the table with `id TEXT PRIMARY KEY` and `pipeline_id ... UNIQUE`. That means two btree index builds.
  - An index build scans the heap through `table_beginscan_strat`. In the installed PostgreSQL 18.4 headers (`/usr/include/postgresql/server/access/tableam.h:899-911`), that function sets `SO_TYPE_SEQSCAN`. That is the flag heapam's scan init uses to call `pgstat_count_heap_scan`.
  - So on a fresh DB, Flyway alone can plausibly leave `seq_scan` at 2 or more on `pipeline_schedules` before tick 1 has issued its query. That is exactly D2's threshold, which would let the harness start while the first pass is still pending or running.
  - I did not reproduce this empirically, because the binding constraints forbid creating a database.
  - It does not matter whether the number turns out to be 0 or 2. Task 1.2 as written ("prove ≥2 ⇒ first pass completed") would pass in both worlds, so it is not a falsifiable proof of the observable.
- **`PORT` env read.** True. Main:227 reads `PORT`, then `HELIO_HTTP_PORT`.
- **`HELIO_UPLOADS_ROOT`.** True. Read at `LocalFileSystem.scala:118`.
- **Spark `--add-opens` flags.** True. They exist at `build.sbt:224-235`, and the project-level `javaOptions` are at :106-120.
- **`.env` override precedence for `sbt run`.** `build.sbt:124` has `Compile / run / envVars ++= loadDotEnv`. Task 1.1 probes this, and it is moot under D3's `java -cp` launch anyway.
- **Register path.** `POST /api/auth/register` is public, with no gate in the route (`AuthRoutes.scala:39-47`).
- **Harness.** It needs `HELIO_API_BASE_URL` and `HELIO_PAT` (`verify.ts:68-70`). The thinning message is at :428.
- **No new deps.** `helio-mcp/package.json` already has `tsx` as a devDependency. Only a script entry is planned.

**Focus questions:**
- **Other backends' purges.** Sound. Sibling backends connect to `helio`, not to `helio_verify_<hex>`. Advisory locks are per-database. Even if a sibling could cause `LockBusy`, the retry is capped at 1440 min.
- **The isolated backend's own passes.** One startup pass, then nothing in-run: interval 1440 and retry capped to 1440. This is sound, provided the completion observable is sound, and it is not yet (CR1).
- **D6 red/green.** Sound. The private stand-in S satisfies C2. Green requires B's deletion with N > 0 inside the window, which satisfies C1. Red is attributed.
- **Teardown/residue.**
  - Exact DB name, PID and ids are recorded in a ledger before each resource is created.
  - Nothing is selected by pattern, and no pkill, pgrep or killall is used.
  - The uploads dir goes under the OS temp dir. The DB is dropped without FORCE, only after the PID is gone.
  - The psql user-row check prevents writes to the shared DB through a port collision.
  - The design never touches matt@helio.dev.

### Verdict: REFUTE

### Change Requests

1. **D2's completion observable must be baseline-relative, not an absolute `≥ 2`.** design.md D2 asserts that nothing else touches `pipeline_schedules` before the harness starts, and that is not true on a fresh DB. The same JVM's Flyway run creates the table, and its PRIMARY KEY and UNIQUE index builds are heap scans flagged `SO_TYPE_SEQSCAN` (PG 18 `tableam.h:903`). They can satisfy `seq_scan + idx_scan ≥ 2` before tick 1 runs. Required changes:
   - (a) Delete the "nothing else touches that table" sentence. Replace it with a baseline rule. Take `v0` from the first `psql` read after health succeeds with the recorded PID alive. Wait until `seq_scan + coalesce(idx_scan,0) ≥ v0 + 2`.
     - This is sound because Flyway runs and closes its own connection before `HttpServer.start`. Session exit flushes its stats, so migration scans are already inside `v0`.
     - Any two later increments must come from two tick queries. The second of those cannot begin until the first tick's `historyWork` finished.
     - State this argument, including the flush-at-session-exit premise, in D2.
   - (b) Rewrite task 1.2 so it can actually fail. Evidence must record:
     - the post-migration value at first health (`v0`, which shows the migration contribution);
     - the subsequent per-tick increments, shown correlating with the tick interval;
     - that the script's proceed point is `v0 + 2`, not the absolute value 2.
   - (c) Optionally state the corner case in D2. `tick()`'s `zip` is fail-fast on Scala 2.13 (`build.sbt:4`), and `candidatesWork` has no `recover`. A failing tick-1 schedule query could therefore complete the tick before `historyWork` ends. That is conservative for this observable only if a failed query does not increment the counter. Either add the note, or have the script also require that the backend log shows no `PipelineSchedulerService.tick() failed` line before proceeding.
2. **Task 3.4 (or 3.5) must evidence the identity guard.** Round-2 CR1 asked for this and it was not carried into tasks.md. The guard is: abort with teardown when the dedicated-DB `psql` check does not find the registered user. A cheap demonstration is enough, for example a unit-level or dry-run path showing the abort branch fires and tears down. The aim is that the guard that protects the shared DB is exercised once, not just written.

### Non-blocking notes

- Exporting `Compile / run / javaOptions` from sbt should already include the project-level `javaOptions` (:106-120), because the scoped `++=` builds on the delegated value. Record the exported list rather than assuming it.
- The project-level `javaOptions` includes `jdk.internal.misc` and `jdk.internal.ref`, which the run-scoped list (:224-235) lacks. Whichever list you export, record it verbatim.
- tasks.md still lists 3.6 after 3.5. This is cosmetic.
