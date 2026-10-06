## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD b16bfa1b3a74905eefc0208a01793efa047909c5 (planning artifacts untracked in the change dir). Read-only:
no backend started, no DB created, shared DB untouched, no MCP tools. `backend/.env` was not read (classifier
denied credential read); its role is inferred only from `application.conf`.

### What I verified (with evidence)

**Round-3 change requests — resolved, not re-worded:**
- CR1 (baseline-relative observable): D2 now reads `v0 = seq_scan + coalesce(idx_scan,0)` after health with the
  recorded PID alive and proceeds at `>= v0 + 2`; the "nothing else touches the table" sentence is gone; the
  Flyway-own-connection / session-exit-flush premise is stated; the fail-fast `zip` corner case is handled by
  refusing to proceed on a `PipelineSchedulerService.tick() failed` log line. Task 1.2 now records v0, per-tick
  increments vs tick interval, and the v0+2 proceed point — falsifiable (a run where v0+2 arrives faster than two
  tick intervals would expose a non-tick increment).
- CR2 (identity-guard evidence): task 3.4a forces the dedicated-DB user-row check to miss and shows abort + teardown.
- Round-1/2 CRs still present: `OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400` (D1/D3), C1/C2 constraints, OS ephemeral
  port, PID-alive health, no-FORCE dropdb after PID gone, ledger-before-create, uploads root under OS temp dir.

**D2 soundness, re-derived from source:**
- `Database.initApp` (`Database.scala:17-29`) runs Flyway via `.dataSource(url,user,password)` — its own
  DriverDataSource connections, closed by `migrate()` — before opening the Slick pools; so migration index-build
  scans are flushed at session exit and land in v0 (health is many seconds later: Spark init, pools, HTTP bind).
- `PipelineSchedulerActor.scala:28-55`: `Tick` at setup; next `Tick` armed only in `TickCompleted`.
  `PipelineSchedulerService.tick()` (:72-106) zips `candidatesWork` with `historyWork`; `historyWork` is
  `purgeIfDue` (thin + payload purge) with `recover` — so tick N+1's schedule query cannot be issued before tick N's
  pass finished, except the fail-fast case the log check covers (the error line is logged in `TickCompleted`,
  before the next tick's query).
- `listTickCandidatesInternal` (`PipelineScheduleRepository.scala:88-91`) is a single-table SELECT on the privileged
  (BYPASSRLS) pool — one scan per tick. The only other `pipeline_schedules` users are the schedule CRUD routes and
  `AgentPreferencesRepository`; none runs before the harness, and D5 orders the D2 wait BEFORE register, so no
  request traffic perturbs the counter. Any two post-v0 tick-query increments include a tick >= 2 query regardless
  of when tick 1 ran or when its stats flushed, so the argument holds. Stats lag (idle flush) only delays.
- `SCHEDULER_TICK_INTERVAL_SECONDS` -> `helio.scheduler.tick-interval-seconds` (`application.conf:141-142`). True.

**Own-pass determinism:** `OutputHistoryRetentionService.claim` stores `now + purgeInterval` before the pass; a
busy pass shortens to `lockRetry`, capped at the interval (`OutputHistoryRetentionConfig.scala:66-69`); a failure
keeps the full interval. With 1440/86400 the isolated backend has exactly one pass in-run. Only other deletion paths
on `output_snapshot_history` are inside `thinAndPurge` (`OutputHistoryRepository.scala:105-140`); the shared-lock
trim (`NodePayloadHistoryRepository.scala:117`) deletes `node_payload_history`, not summary points. Correct.

**Other backends' purges:** every DB connection the backend opens derives from `helio.db.url = ${?DATABASE_URL}`
(`application.conf:16-17`; privileged pool `url = ${helio.db.url}` at :94; `PipelineRunNotifyBus` LISTEN conn from
the same stanza via `Main.scala:105`). Overriding `DATABASE_URL` therefore moves ALL of the isolated backend's
sessions, including its system-context retention pass, off `helio`. Advisory locks and LISTEN/NOTIFY are
per-database, so siblings cannot cause LockBusy or events there. D1's argument holds.

**D6:** red on private S with B at interval 1, A at 1440; C1 attribution (B's deletion line N>0 inside window);
green with B kept demonstrably active on S. C2 respected. The red can fail loudly (recent bucket 5 min collapses 30
points). Sound.

**Other claims:** Main reads `PORT` (:227); build.sbt `javaOptions` :106-120 and `Compile / run / javaOptions`
:224-235 and `.env` `envVars` at :121 exist as cited; `helio-mcp/package.json` has `tsx` devDep, no `pg`; harness
needs `HELIO_API_BASE_URL`/`HELIO_PAT` (`verify.ts:68-70`); thinning message at :428; root Jest collects
`helio-mcp/scripts/*.test.ts` (`jest.config.cjs`, README:277).

**Teardown/residue:** exact DB name/PID/ids, ledger before create, no pattern selection, no pkill/pgrep/killall, no
`matt@helio.dev`, nothing under `~`, no new deps, C2 forbids shortened purger on `helio`. Sound, subject to note 1.

### Verdict: CONFIRM

### Non-blocking notes

1. D3's sentence "a sibling lane's server that happened to grab the port can never receive the bootstrap user" is an
   overclaim: `POST /api/auth/register` is itself a write and precedes the psql user-row check. On bind failure Main
   logs and calls `system.terminate()` (`Main.scala:316-324`), so the PID stays alive briefly while health could hit
   another listener. Practical risk is near nil (ephemeral port range; shared-DB lanes bind configured ports from 8080
   upward), but the executor should add a pre-write identity check and fix the wording — e.g. require the recorded
   JVM's OWN stdout to have printed `Helio backend listening on` before health counts, or confirm via
   `ss -ltnp 'sport = :<port>'` that the listener's pid equals the recorded PID.
2. Guards without an exercising task: port-already-answers fail-fast, D2 timeout -> teardown + non-zero, tick-failed
   log refusal, CREATEDB-missing message, and "unconfirmed removal -> non-zero". None protects the shared DB (a
   premature proceed fails loudly, not falsely), so not blocking; a cheap forced-path demo of the D2 timeout and of an
   unconfirmed dropdb would strengthen the final gate.
3. Teardown revokes the bootstrap PAT via the API; if the JVM already died, that step cannot confirm, though dropdb
   makes it moot. Define it so a dead-JVM path does not spuriously fail an otherwise clean teardown (or reports it
   as moot rather than unconfirmed).
4. 3.6 still follows 3.5 after 3.4a — cosmetic.
