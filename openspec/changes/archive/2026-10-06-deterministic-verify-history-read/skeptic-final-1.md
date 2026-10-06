## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `889b43984cb59c929c71a4177373daffcfaba028`. The base was resolved live with `resolve-review-base.sh`: `b16bfa1b3`, which already includes HEL-1343 (`f78b4c518`). The spawn-cwd guard printed READY.

### What I verified (with evidence)

**The diff matches its scope.** `git diff b16bfa1b3...HEAD --stat` shows:
- `helio-mcp/` changes: scripts, README, and `package.json` (script entry only).
- The change dir.

There are no changes to `backend/`, `frontend/`, `ci.yml`, `playwright.config.ts`, `.gitignore`, any lockfile, or dependencies.

**AC1: the read is deterministic. I traced this in the backend source myself.**
- **Other backends cannot reach the data.** The only DELETEs on `output_snapshot_history` are in `OutputHistoryRepository.thinAndPurge`, at lines 111, 120 and 134. A backend can only delete in the database it connects to.
  - The isolated JVM gets an explicit env from `isolatedRun.ts:233-260`, with `DATABASE_URL` set to the dedicated DB.
  - `Main.scala:227` reads `PORT`.
  - The jar is launched directly, so the `.env` override in sbt's `envVars` does not apply. The executor's probe 1.1 showed that `.env` wins under `sbt run`, and the launcher correctly avoids that path.
- **The HEL-1343 lock retry cannot cause an in-run pass.** Postgres advisory locks are scoped to one database, so a sibling backend cannot make the isolated pass return LockBusy.
  - `OutputHistoryRetentionConfig.scala:66-69` caps `lockRetry` at the interval. With `LOCK_RETRY_SECONDS=86400` and an interval of 1440, the retry is 1440 min.
  - `OutputHistoryRetentionService.scala:74-76` shows that a failed pass keeps the full interval.
  - So after `claim` (lines 101-107), no second pass is possible in the run.
- **The shared-lock payload trim cannot thin the fixture.** It is at `NodePayloadHistoryRepository.scala:117`. It only deletes `node_payload_history` rows and never history points. If it contends with the purge, the outcome is LockBusy, which leads to the 1440-min retry above.
- **The first pass is proven complete before the harness starts.** `PipelineSchedulerActor` re-arms `Tick` only on `TickCompleted` (lines 47-55). `tick()` zips `historyWork` (`PipelineSchedulerService.scala:99-106`).
  - So a second scan of `pipeline_schedules` means the first pass has finished.
  - The script also refuses to proceed if the log contains a tick-failure mark, or if the wait times out (`isolatedRun.ts:263-295`).
  - The only non-tick reader of `pipeline_schedules` is the schedule routes, and none of them is called before register.

**My own live run of `npm run verify:isolated`.** helio-mcp was built fresh first: `dist/index.js` mtime 10:08:53, and `backend/src/main` has no files newer than the jar. Log: scratchpad `hel1297-skeptic-isolated.log`.
- Exit 0.
- DB `helio_verify_87249b1046f3`, JVM pid 217453 on port 38835.
- D2 counter: v0=2, then 3, then 4, all before register.
- `ONE get_output_history call: points=30 sparkline=30`.
- Teardown: harness stopped, bootstrap PAT `fb6d168e-…` revoked (401), JVM stopped, DB dropped and confirmed absent.

I then checked independently, by the recorded ids:
- `kill -0 217453` and `kill -0 217676` both report "No such process".
- `pg_database` count for that exact name is 0.
- The masked Flyway URL in `backend.log` decodes to `.../helio_verify_87249b1046f3?...`, so the JVM really was on the dedicated DB.

**Red/green proof and C1: I read the raw logs, not just the evidence summary.**
- **Red** (`hel1297-proof-red-d65508`).
  - Driver ledger: A pid 88168 with overrides `{}`, and B pid 88359 with `{"OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES":"1"}`, both on stand-in `helio_verify_standin_b72f110fa1`.
  - Window: 09:09:03.777 to 09:11:03.007.
  - B.log:84 reads `09:10:03.162 ... retention deleted 36 point(s)`, which is inside the window.
  - A.log has 0 deletion lines, so the thinning is attributable to B.
  - Harness result: `points=12`, exit 1, and the new message names `npm run verify:isolated`.
  - The second red run, the one cited in evidence-proof.md (09:19:38 to 09:21:01, deleted 36 at 09:20:37.899), matches the driver log.
- **Green** (`hel1297-proof-green-630910`).
  - Harness window: 09:45:50.109 to 09:45:56.477.
  - B.log:86 reads `09:45:53.728 ... deleted 18 point(s)`, inside the window.
  - Result: 30/30, exit 0.
  - Attempt 1 had no B pass in its window, and the evidence discloses this honestly.

C1 holds for both red and green. None of these claims depends on mtime ordering; all of them rest on timestamps inside the log lines.

**C2.** The stand-ins are private `helio_verify_standin_*` DBs. The isolated code connects only to the `postgres` maintenance DB and to its own dedicated DB.

**C3.** `listenerIsRecordedJvm` (`isolatedBackend.ts:122-130`) runs before register (`isolatedRun.ts:188`). The PID is the JVM itself because `nice` execs `java`, so it is the same PID. The post-register user-row check is at `isolatedRun.ts:197-202`. The forced-miss demo (`hel1297-demo-idmiss.log`, summarized in evidence) shows an abort followed by teardown.

**C4.** The dead-JVM branch logs the revoke as "moot" (`isolatedRun.ts:129-134`).

**Residue.** I ran a read-only listing of `pg_database` names matching `helio_verify%`: it returned nothing. Every proof PID recorded in evidence is not alive: 88168, 88359, 115063, 115169, 154769, 154994, 166031, 199276 and 199508.

**AC2: README accuracy.** I checked the "Isolated verify run" section against the code:
- The env values are correct.
- The ephemeral port, D2, C3 and teardown order (harness, then PAT, then JVM, then DB) match `isolatedRun.ts:114-151`.
- The rate-limit lift is described accurately.
- The HEL-1343 explanation is correct, as traced above.
- The `assembly` jar path matches `build.sbt:86-90`.

**Gates, re-run by me:**
- helio-mcp `tsc` typecheck exits 0, and its include list covers `scripts/**`.
- eslint on the new scripts is clean.
- prettier check passes.
- Root jest: 439 suites / 4581 tests passing. helio-mcp: 39 suites / 375 tests.

**No UI changes**, so I skipped the design-judgment step.

### Verdict: CONFIRM

### Non-blocking notes

- **Signal during `createdb`.** `isolatedRun.ts:169-170` sets `state.dbCreated = true` only after `createDb` resolves. If SIGINT or SIGTERM arrives while `createdb` is running, the memoized teardown runs with `dbCreated=false`, and the database is left behind without being reported as unconfirmed. The window is small, and the name is already in the ledger at line 167. A fix is to mark the DB pending before `createDb`, or to have teardown await the in-flight create.
- **Leftover work dir.** The run's work dir under the OS temp dir (`ledger.txt` and `backend.log`) is left behind on purpose for the ledger. The README mentions only the ledger. `backend.log` is about 34 KB per run, and Flyway masks its credentials.
- **Possible orphan on harness SIGKILL.** `stopPid` on the harness targets the `tsx` wrapper PID. If it has to escalate to SIGKILL, the wrapper's node child could be orphaned. This is moot for data, since the DB is dropped, but it is a possible stray process.
