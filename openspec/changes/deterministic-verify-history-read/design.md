## Context

See proposal.md (Why). Ground truth on main (b16bfa1b3):

- `OutputHistoryRepository.thinAndPurge` thins with one `DELETE ... row_number() OVER (PARTITION BY output_id,
  age_class, floor(epoch / bucket_secs))` over the WHOLE `output_snapshot_history` table, using the policy of the
  backend running the pass. Guarded by `pg_try_advisory_xact_lock(PurgeAdvisoryLockKey)`; a busy lock skips.
- `OutputHistoryRetentionService` gates passes in-process: `nextDue` starts `None`, so the FIRST scheduler tick runs a
  pass; afterwards one pass per `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES` (default 60). HEL-1343: a `LockBusy` pass is
  retried after `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` (default 120, capped at the interval).
- `PipelineSchedulerActor` sends itself `Tick` at actor setup (no initial delay), then every
  `SCHEDULER_TICK_INTERVAL_SECONDS` (default 30). Spawned in `Main.scala` before `HttpServer.start`.
- Every worktree's `backend/.env` points at `jdbc:postgresql://localhost:5432/helio`. `backend/build.sbt` adds the
  `.env` map via `Compile / run / envVars ++= loadDotEnv(...)` (claim to verify: this overrides a shell-exported
  `DATABASE_URL` for `sbt run`).
- `helio-mcp/scripts/verify.ts` needs `HELIO_API_BASE_URL` + bootstrap `HELIO_PAT`; it mints its own run PAT and tears
  down every fixture by exact id (`verifyFixtures.ts`).

## Goals / Non-Goals

**Goals:** a verify run whose 30-point read cannot be thinned by any backend other than its own, and whose own backend
cannot run a pass after the fixture's first point exists; zero residue on the shared dev DB from the isolated run.

**Non-Goals:** backend changes; CI wiring; changing plain `npm run verify`'s target.

## Decisions

### D1. Dedicated database, not `OUTPUT_HISTORY_*` on the verify backend

Env settings only govern passes run BY the backend that reads them. The thin DELETE above is table-wide and uses the
purging backend's policy, so a sibling worktree backend at defaults (60-minute interval, 5-minute recent bucket)
thins the fixture regardless of the verify backend's own settings — the HEL-1274 lane's `PURGE_INTERVAL=1440` only
silenced its own backend. No value exempts specific Outputs (no exemption column/predicate exists). A dedicated
database removes the other backends from the equation: they can only delete rows in the database they connect to.

HEL-1343 interaction (corrected after design gate round 1): `LockBusy` needs a second session holding the purge key.
Sibling backends never connect to the dedicated DB, so they cannot cause it. But the isolated backend's OWN pipeline
runs can: `NodePayloadHistoryRepository.scala:117` takes the same key SHARED
(`pg_try_advisory_xact_lock_shared`) before the write-time payload trim, so a pass overlapping a run gets `LockBusy`
and would be re-armed `lockRetry` (120 s) later — inside the harness window. Today that is latent only because the
throwaway user is free-tier (free payload defaults fail `allowsPayloads`, `PayloadHistoryConfig.scala:11`) and the
harness opts no Output into `historyPayloads`. The isolated backend therefore also sets
`OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400`; `OutputHistoryRetentionConfig.scala:66-69` caps it at the interval, so the
effective retry is 1440 min and the guarantee no longer depends on either latent fact. On the SHARED DB, contention
makes siblings retry in 120 s, i.e. it increases purge frequency there — another reason the shared DB cannot be made
safe from the verify side.

**Alternative rejected — hold the purge advisory lock from the harness for the run** (`pg_advisory_lock` on the same
key blocks every backend's `pg_try_advisory_xact_lock`). Deterministic on the shared DB, but it suspends retention
for every lane for ~6 min (a lane live-verifying retention would see its own passes skip), and couples a TS harness to
a `private[persistence]` Scala constant. Rejected for cross-lane side effects.

### D2. The isolated backend's own passes cannot land on the fixture

With `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1440` and `OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400` (effective 1440 min),
the isolated backend runs exactly one pass in the run — at its first scheduler tick (`Tick` sent at actor setup) —
and neither a busy nor a failed first pass can schedule a second in-run pass. The only remaining exposure is that
first pass still EXECUTING its DELETE after the fixture has two points in one bucket. The script MUST start the harness
only after that first pass has COMPLETED (claimed is not enough: the DELETE removes whatever is in the table when it
executes). Observable: `PipelineSchedulerActor` schedules tick N+1 only on `TickCompleted`, and
`PipelineSchedulerService.tick()` zips `historyWork`, so any observable effect of the SECOND tick proves the first
pass finished. Concrete observable (no timed fallback, baseline-relative): every tick's first query reads
`pipeline_schedules` (`PipelineScheduleRepository.scala:88-91`). Flyway's own DDL/index builds on that table also count
as scans, so an absolute threshold is unsound. Rule: after health succeeds with the recorded PID alive, the script
reads `v0 = seq_scan + coalesce(idx_scan,0)` for `pipeline_schedules` from `pg_stat_user_tables` via `psql` against
the recorded dedicated DB name, then polls until the value is ≥ `v0 + 2`. Soundness: Flyway runs on its own connection
and closes it before `HttpServer.start`; session exit flushes its stats, so migration scans are already inside `v0`.
Any two later increments come from two tick queries, and the later tick cannot begin until the earlier tick's
`historyWork` finished (next `Tick` is scheduled only on `TickCompleted`). Stats lag only delays the proceed point.
Corner case: `tick()`'s `zip` is fail-fast, so a FAILED schedule query could complete a tick before `historyWork`
ends; the script therefore also refuses to proceed if the backend log contains `PipelineSchedulerService.tick()
failed` (teardown + non-zero). Bounded timeout → teardown + non-zero exit; never proceed on a timeout. The isolated
backend may set `SCHEDULER_TICK_INTERVAL_SECONDS` low (e.g. 5) to shorten the wait. A completed first
pass on a fresh DB logs nothing at INFO (it deletes 0), so INFO logs are not an acceptable observable.

### D3. Launch the backend as a process whose PID is the server

The script starts the backend such that the recorded PID is the server JVM itself (e.g. `java -cp <exported runtime
classpath> <main>`), with an explicit environment: `backend/.env`'s values, then overrides `DATABASE_URL` (dedicated
DB), `PORT`, `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1440`, `OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400`, and a
run-scoped `HELIO_UPLOADS_ROOT` under the OS temp dir (never under `~`) that is removed at exit. The classpath export
command (sbt 2, e.g. `export Runtime / fullClasspath`) is recorded in evidence; every sbt step runs under `nice -n 19`. An `sbt run` wrapper whose PID is not the forked JVM is not acceptable (stopping it by PID can orphan the
server). Stop = signal that exact PID, wait for exit, confirm the port no longer answers.
The launch also passes `Compile / run / javaOptions` (effective list: the project-level `build.sbt:107-121` plus the `:224-235` addendum, de-duplicated; the
`--add-opens` flags Spark local needs on Java 21), exported from sbt and recorded VERBATIM alongside the classpath.

Port and identity: the port is obtained from the OS (bind `127.0.0.1:0` in Node, read the assigned ephemeral port,
close) — never from the 8080-upward lane range. Health success counts only while the recorded PID is alive. Before ANY write,
including register, the C3 listener-identity proof runs: `ss` reports the listener PID on the port equal to the recorded PID
(or, if `ss` cannot attribute, the recorded JVM's own log shows it listening on that port). After register, and before the
bootstrap PAT is minted, the script also confirms via `psql` against the recorded dedicated DB name that the just-registered
user's row exists THERE — a second, post-register confirmation (register itself is a write, so this check alone could not
keep a foreign server from receiving it); on a miss it aborts with teardown.

### D4. Bootstrap credential lives and dies with the dedicated DB

The script registers a throwaway user via `POST /api/auth/register` on the isolated backend and mints the bootstrap
PAT with that session, then passes both to the unchanged harness (which still mints/revokes its own run PAT and tears
down fixtures). Revoke the bootstrap PAT at the end; dropping the database removes the user. Nothing is written to the
shared dev DB.

### D5. Script shape and lifecycle

`helio-mcp/scripts/verifyIsolated.ts` (run via the existing `tsx` devDependency; `npm run verify:isolated`), no new
dependencies. DB create/drop and any probe queries go through the `createdb`/`dropdb`/`psql` CLIs via
`child_process`, with host/port/user parsed from `backend/.env`'s `DATABASE_URL` (user/password
live in its QUERY string, `?user=…&password=`; the dedicated-DB override keeps that query string) — never a `pg` npm dependency
(HEL-1204 audit gate). Fail fast with a clear message if the role lacks CREATEDB, or if the port already answers.
Sequence: create DB `helio_verify_<random hex>` → start backend → wait health (bounded) → D2 wait → register + mint →
run `verify.ts` as a child with `HELIO_API_BASE_URL`/`HELIO_PAT`.

Teardown (one function, idempotent) runs from `finally` AND from SIGINT/SIGTERM handlers: revoke bootstrap PAT →
signal the recorded PID, wait until it is confirmed gone → only then `dropdb` the recorded name (no `WITH (FORCE)`; a short bounded retry on the same exact name
covers Postgres session-exit lag) →
remove the uploads dir. Each step is confirmed and reported; any unconfirmed removal → non-zero exit naming it.
Ledger: every identifier (DB name, uploads dir, JVM PID, user id/email, bootstrap PAT id) is printed to stdout AND
appended to a run ledger file (in the OS temp dir, path printed at start) BEFORE/at creation of the resource, so an
interrupted or crashed run leaves exact names for manual removal; the JVM PID is printed before the health wait.

### D6. Proof (red/green) without perturbing other lanes

Running a 1-minute purger against the real shared DB would thin OTHER lanes' live history, so the shared DB is
modelled by a private stand-in database S, using the same D3 launcher (PIDs recorded identically):
- Red: backend A (interval 1440, verify target) and backend B (`OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1`) both on S;
  run the harness against A → fewer than 30 points, non-zero exit naming the count. Attribute the cause: capture B's
  "Output history retention deleted N point(s)" line with N > 0, timestamped inside the harness's start→finish window.
- Green: B keeps purging S while `verify:isolated` runs on its own DB, AND dense history keeps being generated on S
  throughout (e.g. repeated runs of a fixture pipeline via A on S) so B is shown active: capture B's deletion line
  with N > 0 timestamped inside the green run's window. Result → 30/30, exit 0.
Full logs go to the session scratchpad (`hel1297-*`); summaries into the change dir as evidence. S, its users, PATs
and backends are removed by recorded name/id/PID afterwards.

## Risks / Trade-offs

- [JVM start + Flyway on a fresh DB is slow] → bounded health wait with a clear timeout message; documented cost.
- [Machine load: up to 3 JVMs during the green proof (A, B, isolated)] → every JVM and sbt step under `nice -n 19`.
- [Isolated mode not used by habit] → harness thinning error and README point to it.

## Planner Notes

- Self-approved: dedicated DB over lock-holding (D1); no backend change; private stand-in for the red repro (D6).
- `skip_specs` not used: the verify-harness spec gains a behavioural requirement.

## Implementation Notes (executor)

- D3 deviation: sbt 2's `export Runtime/fullClasspath` yields virtual `${OUT}`/`${CSR_CACHE}` references unusable by `java -cp`; the
  launcher runs the production `sbt assembly` jar (`java --add-opens... -jar`), keeping the recorded PID the server JVM itself.
- The isolated backend also sets `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` and `RATE_LIMIT_REQUESTS_PER_WINDOW` high: with defaults, a 429
  `Retry-After` of 59 s outlasted the MCP client's 60 s request timeout and failed a run (see evidence-teardown-demos.md).
- Cookie-authenticated writes (`POST /api/tokens`) need the CSRF header `X-Helio-Requested-With: 1`.
