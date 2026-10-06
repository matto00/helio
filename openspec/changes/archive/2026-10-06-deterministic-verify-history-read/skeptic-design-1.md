## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD b16bfa1b3a74905eefc0208a01793efa047909c5. The planning artifacts are untracked files under the change dir.

### What I verified (with evidence)

- **Context claim: the thin DELETE covers the whole table and uses the purging backend's policy.** True.
  `OutputHistoryRepository.scala:133-150` runs `row_number() OVER (PARTITION BY output_id, age_class,
  floor(epoch / bucket_secs))` over all of `output_snapshot_history`, with bucket widths taken from the caller's
  `policy`. The `pg_try_advisory_xact_lock(PurgeAdvisoryLockKey)` guard is at :154, and `LockBusy` is returned at :158.
- **Context claim: `nextDue` starts at `None`, the CAS claim happens before the repo call, and HEL-1343 shortens
  the next pass on `LockBusy`.** True. See `OutputHistoryRetentionService.scala`: `nextDue = AtomicReference(None)`;
  `claim()` stores `now + purgeInterval`; when a part is busy and nothing failed, it sets
  `nextDue.compareAndSet(claimed, now + lockRetry)`. Busy from EITHER the history part or the payload part triggers
  that retry.
- **Context claim: `lockRetry` defaults to 120 s, capped at the interval.** True.
  `OutputHistoryRetentionConfig.scala:66-69` reads `positive("OUTPUT_HISTORY_LOCK_RETRY_SECONDS", 120)`, and
  `if (retry > purgeInterval) purgeInterval else retry`.
- **Context claim: the actor ticks at setup, and the scheduler is spawned before `HttpServer.start`.** True.
  `PipelineSchedulerActor.scala:30` does `context.self ! Tick`. The next Tick is scheduled only on `TickCompleted`
  (:50-55), and `PipelineSchedulerService.tick()` zips `historyWork`, so tick N+1 cannot start before tick N's
  retention pass has finished. `Main.scala:304` spawns the actor and :316 starts `HttpServer.start`.
- **Context claim: `.env` points at the shared DB, and `build.sbt` adds the `.env` map to `run`.** True.
  `backend/.env` has `DATABASE_URL=jdbc:postgresql://localhost:5432/helio`, and `build.sbt:124` has
  `Compile / run / envVars ++= loadDotEnv(...)`. Precedence is left to probe 1.1, which is the right call.
- **Harness facts.** `verify.ts:368-430` has `HISTORY_RUNS = 30`, a 6-minute budget, and the thinning error message
  at :428. helio-mcp has no Postgres client dependency (`package.json`). `psql`, `createdb` and `dropdb` exist at
  `/usr/bin`. `/api/auth/register` (`AuthRoutes.scala:39`) and `tokens` (`ApiTokenRoutes.scala:30`) exist.
- **Q1, whether a dedicated DB holds against OTHER backends.** Yes. Every DELETE in `thinAndPurge` and
  `NodePayloadHistoryRepository.purge` is an ordinary statement inside the purging backend's own connection. A
  backend on database `helio` cannot delete rows in `helio_verify_<hex>`. Sibling settings, including HEL-1343
  retry, cannot reach the isolated DB. That part of D1 is sound.
- **Q1, HEL-1343 on the dedicated DB.** D1's statement is **factually wrong**; see CR1.
  `NodePayloadHistoryRepository.scala:117` shows that the isolated backend's OWN pipeline runs take the same key
  SHARED (`pg_try_advisory_xact_lock_shared(PurgeAdvisoryLockKey)`) for the write-time payload trim. Each run uses
  its own pooled session. A retention pass overlapping such a run gets `LockBusy`, which moves `nextDue` to
  now + 120 s. That is well inside the 6-minute harness window, and the next pass would thin the fixture with
  5-minute buckets. Today this is latent rather than live, for two reasons. The registered user is free-tier, and
  the free-tier payload defaults (runs 0) fail `allowsPayloads` (`PayloadHistoryConfig.scala:11`). Also, nothing
  in `helio-mcp/scripts` or `helio-mcp/src` sets `historyPayloads` (grep: 0 hits). So the design's reason is wrong,
  even though the outcome holds today only because of two facts the design never mentions.
- **Q2, D2's reasoning.** It is mostly sound but anchored on the wrong event; see CR2. What matters is whether the
  first pass has COMPLETED (released its DELETE) before the fixture has 2 points in one bucket. Whether it has been
  "claimed" is not enough: `thin` classifies with the claim-time `now` but deletes whatever is in the table when
  the statement executes. Also, the success path logs only when `deleted > 0` and the busy path logs only at DEBUG,
  so on a fresh DB a completed first pass produces no log line at all. Probe 1.2 needs a stated observable.
- **Q3, D6 red/green.** The red is a fair accelerated model: same table-wide DELETE, interval shortened from 60 to
  1 minute, on a private stand-in so other lanes are not perturbed. The green as written does not demonstrate its
  own premise; see CR3. B's INFO line only appears when it deletes something. After red, S has already been
  thinned, so during green B will delete 0 and log nothing. "B keeps purging S every minute" would then be
  asserted, not shown.
- **Q4, the rejected lock-holding alternative.** The reasons are sound. A session-level `pg_advisory_lock` on the
  shared key suspends retention, and the shared-lock payload trim, for every lane. A crashed harness holding it
  would extend that indefinitely. It would also couple TS to a `private[persistence]` constant. Rejection is
  correct.
- **Q5, residue and teardown.** Exact DB name, exact PID, and stop-by-PID are good, and nothing is chosen by
  pattern. But "teardown in `finally`" does not run on SIGINT/SIGTERM in Node (the default handler exits without
  unwinding). A spawned `java` child is not killed when its Node parent dies. An interrupted run would therefore
  leave a live JVM and a database with nothing recording their names. The run-scoped `HELIO_UPLOADS_ROOT`
  location is also unspecified, and the backend default is `~/.helio/uploads`, which is outside the repo. See CR4.
- **Scope and AC coverage.** AC1 (deterministic read) is covered by D1-D5 and tasks 2.1-2.3. AC2 (README) is
  covered by task 2.4. Driver requirements are covered: explain against other backends and HEL-1343 (2.4), red/green
  (3.2/3.3), fresh build (3.1), no deps (2.2), teardown by exact names (3.4). The backend is untouched, and none of
  `ci.yml`, `playwright.config.ts`, `.gitignore` or `frontend/package-lock.json` is in Impact. There are no
  TODO/TBD placeholders.

### Verdict: REFUTE

### Change Requests

1. **Correct D1's HEL-1343 paragraph and close the retry path explicitly.** In design.md D1, "On the dedicated DB
   the only client is the isolated backend, so it never sees `LockBusy`" is false. Per
   `NodePayloadHistoryRepository.scala:117`, the isolated backend's own runs take the purge key shared during the
   payload trim. A pass overlapping one gets `LockBusy` and retries after 120 s, inside the harness window.
   Required changes:
   - D3 must also set `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` to a value ≥ the interval, e.g. `86400`. Per
     `OutputHistoryRetentionConfig.scala:66-69`, it is capped at the interval, so the effective retry becomes
     1440 min and a busy pass cannot schedule an in-run repeat.
   - D1 and the README (task 2.4) must state the true reason: own-runs can hold the key shared; today's harness
     user is free-tier and opts no Output into `historyPayloads`; and the env override makes the guarantee
     independent of both facts.
   - Add the variable to the spec requirement's wording, or at least to D3's explicit env list.
2. **Re-anchor D2 on completion and name the observable.** Change "after that first pass has been claimed" to
   "after that first pass has completed". In task 1.2 / D2, name what evidence shows completion. Neither outcome
   logs at INFO on a fresh DB. The structural fact that the next Tick is scheduled only after `TickCompleted`, which
   waits on `historyWork`, is a usable basis: any per-tick observable from the second tick proves the first pass
   finished. Otherwise, use a wait justified from that ordering. If CR1's env override is adopted, state that a
   busy or failed first pass can no longer cause a second in-run pass. The only remaining exposure is a first pass
   delayed past the fixture's second point.
3. **Make D6's green prove the purger was actually active.** During green, B must be shown deleting rows on S. For
   example, keep generating dense history on S (runs against A or B on S) through the green window, and capture
   B's "Output history retention deleted N point(s)" line, with N > 0, timestamped inside the green run's
   start-to-finish window. Otherwise, run B with DEBUG for the retention logger and show its passes. Without this,
   the green cannot be distinguished from "B was idle". Apply the same timestamp-inside-window requirement to red,
   so the cause is attributed rather than assumed.
4. **Specify interrupt-safe teardown and the uploads/DB-tool mechanics in D5.**
   - (a) Install SIGINT/SIGTERM handlers that run the same teardown. Write each recorded identifier to stdout and
     to a run ledger file BEFORE creating the resource: DB name, PID, uploads dir, user id/email, bootstrap PAT id.
     An interrupted run then leaves exact names for manual removal.
   - (b) Spawn the JVM so a parent crash cannot silently orphan it, or at minimum print its PID before health-wait.
   - (c) Fix `HELIO_UPLOADS_ROOT` to a path under the worktree or the OS temp dir, never under `~` outside the repo.
   - (d) State that DB create/drop goes through the `createdb`/`dropdb`/`psql` CLIs via `child_process`, with
     parameters parsed from `backend/.env`. No `pg` dependency (the HEL-1204 audit gate).
   - (e) Drop only after the PID is confirmed gone. Never use `WITH (FORCE)`, unless it is scoped to the recorded
     name and justified.

### Non-blocking notes

- D3's "exported runtime classpath" under sbt 2 needs a concrete command (e.g. `export Runtime / fullClasspath`).
  Have the executor record it in evidence, and run any sbt step with `nice -n 19`.
- Creating a database on the shared server needs CREATEDB on the role `.env`'s URL resolves to (none is embedded,
  so it is the OS user). Probe it early and fail with a clear message. Flyway on a fresh DB may also need cluster
  roles that already exist; worth a note in the README.
- Red/green setup reuses the same launcher (D3) for A, B and S. Say so in tasks 3.2/3.3 so the PIDs are recorded
  the same way.
