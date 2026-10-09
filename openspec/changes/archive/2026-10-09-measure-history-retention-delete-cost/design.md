## Context

See proposal.md (Why). The retention tick on origin/main (023aa4bb) is `OutputHistoryRetentionService.purgeIfDue`,
gated per process by `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES` (60), with the HEL-1343 lock-retry window (120 s). It runs
two transactions on the privileged pool (`SET LOCAL ROLE helio_privileged`, BYPASSRLS), each opening with
`pg_try_advisory_xact_lock(0x48454C31323732)`:

1. `OutputHistoryRepository.thinAndPurge`: one age-purge DELETE per named tier (free/beta/owner) plus one unnamed-tier
   catch-all, each `USING pipelines p, users u ... AND h.captured_at < cutoff`; then the thin DELETE, which ranks every
   row twice (`row_number()` per Output for the protected newest 101, then per `(output, age_class, bucket)`).
2. `NodePayloadHistoryRepository.purge`: disallowed-tier, per-tier age, per-tier per-node newest-N, unreferenced.

Indexes today: `output_snapshot_history (output_id, captured_at DESC)`, partial `(payload_id) WHERE payload_id IS NOT
NULL`, pkey; `node_payload_history (pipeline_id, node_step_id, root_id, captured_at DESC)`, pkey. Nothing leads with
`captured_at`. Local Postgres is 18.4, CI is 16, prod's major version is unrecorded in the repo (MISTAKES.md: versions
drift). Migration head is V118; V119 is HEL-1347's (applied to the shared dev DB already); V120 is free on every branch.

## Goals / Non-Goals

**Goals:** recorded `EXPLAIN (ANALYZE, BUFFERS)` plans and timings for every retention DELETE at stated volumes; an
extrapolated per-tick cost; a cadence/lock verdict; an index only where measurement shows it bounds a full scan.

**Non-Goals:** rewriting the thin query, changing cadence, lock, or retention semantics (see proposal Non-goals).

## Decisions

**D1. Scratch database, never the shared dev DB.** Create `helio_hel1284_scratch` on localhost and migrate it with
the repo's own pinned Flyway (10.20.1, the version `Database.initApp` uses) **without starting `Main` and without
`sbt run`**: `sbt run` loads `backend/.env` (build.sbt:124), whose `DATABASE_URL` points at `helio` and overrides a
shell-exported value, so a boot would migrate and then retention-tick the shared DB. Instead: build the assembly jar (`nice -n 19 sbt assembly` in `backend/`; it never invokes
`run`/`test`, the only tasks that load `.env`, and its merge strategy keeps Flyway's plugin registrations; `sbt export`
prints virtual `${OUT}` paths jshell cannot use, per archive `2026-10-06-deterministic-verify-history-read`), then run one
`jshell --class-path <worktree>/backend/target/scala-2.13/helio-backend.jar` snippet calling
`Flyway.configure().dataSource("jdbc:postgresql://localhost:5432/helio_hel1284_scratch", "matt", "")
.locations("filesystem:<worktree>/backend/src/main/resources/db/migration").load().migrate()` with the scratch URL as a
literal. No task that loads `.env` is invoked, and no scheduler exists in that process. The role is `matt`, the local
superuser that installed all of `helio`'s migrations (`installed_by`): V34's `GRANT helio_privileged TO current_user` is
cluster-wide, and is a no-op only for that role. A Flyway "PostgreSQL 18.4 newer than tested" warning is expected and
recorded. Positive checks, recorded: the snippet prints the
`MigrateResult`'s `database` and `targetSchemaVersion` (must be `helio_hel1284_scratch` / `118`); the scratch DB's
`flyway_schema_history` has 118 rows whose `installed_on` lies inside the recorded migrate window; and `helio`'s
`flyway_schema_history` has zero rows with `installed_on` inside that window. Seed and measure only in the scratch DB,
and `DROP DATABASE helio_hel1284_scratch` by that exact name at the end. `helio_privileged` is cluster-global and is
never dropped. No temporary role is created.

**D2. Model the thinned steady state, not 105M raw rows.** Thinning runs hourly, so raw points never accumulate. At a
5-minute cadence an Output's steady state is ~288 (24 h × 5 min) + ~144 (1–7 d hourly) + one per day from 7 d to its
tier cap: owner (365 d) ≈ 790, beta (90 d) ≈ 515, free (30 d) ≈ 455 rows (the protected 101 fall inside 24 h). Tier
mix **M** = 70% free / 25% beta / 5% owner by Output (a freemium population; owner is the operator tier), every Output's
depth seeded from its own tier cap. Scenarios, **measured one at a time**: for each, `TRUNCATE` history/payload/
outputs/pipelines/users in the scratch DB, seed, `VACUUM ANALYZE`, measure, then the next scenario:
- **S1** 1k Outputs, mix M, steady state (~0.5M rows) — the ticket's example volume in the form it actually takes.
- **S2** 10k Outputs, mix M, steady state (~5M rows) — 10× headroom. **The index decision (D4) is made on S2.**
- **S2-owner** 10k all-owner Outputs (~8M rows) — worst case for the thin DELETE only; its age-purge plans for the
  empty tiers are degenerate and are recorded but not used for D4.
- **S3** backlog: 1k Outputs, mix M, 7 days of un-thinned 5-minute points (~2M rows).
Each is seeded as of `now - 1 h` plus one hour of new points, and the age purges get their real hourly work: for a
deterministic 1/24 of each tier's Outputs, the oldest daily point lies past that tier's cap by < 1 h (one point each),
which is what an hourly tick finds at steady state. `summary` JSONB sized from the dev DB's mean, reproduced by a
recorded read-only query (`avg(pg_column_size(summary))`). Payloads: a stated opt-in fraction of beta/owner nodes with a stated
row-size distribution,
within tier caps, plus some unreferenced and disallowed-tier rows. Seed SQL is committed (D5).

**D3. Measurement method.** Each DELETE is run as `BEGIN; EXPLAIN (ANALYZE, BUFFERS) <the exact statement text from
origin/main, parameters substituted>; ROLLBACK;` three times, reporting the median plus the first run's buffers.
Then each repository's whole transaction (lock acquire + all its statements, in origin/main order) is timed as its own
transaction, rolled back: that time is that transaction's **lock hold time**; their sum is the tick's wall time.
Session settings are Postgres defaults for `work_mem` and `max_parallel_workers_per_gather` (≤2 workers), stated in the
evidence. Extrapolation beyond S2 is linear in rows for scans and `n log n` for the thin sort, stated as an assumption.

**D4. Index decision rule (evaluated on S2, mix M).** For each DELETE, read from EXPLAIN ANALYZE the rows read from the
target table (all scan nodes on it) versus the rows actually deleted. A statement qualifies when it reads the full table
and deletes < 1% of what it reads. For qualifying age purges the after-measurement compares at least two candidates on
the three named-tier history age purges (the unnamed-tier catch-all is recorded but excluded: V88 limits `users.tier`
to free/beta/owner, so it matches no row in any environment): `(captured_at)` and the join-driven `(pipeline_id, captured_at)`; and the analogous pair on
`node_payload_history` if its age purge qualifies. Pick by measured plans (rows read, buffers, time) summed across the
three named-tier purges, plus insert-path cost; add none if neither bounds rows read. The thin DELETE and the payload per-tier
newest-N DELETE rank every row by design and cannot be index-bounded; their plans and costs are recorded, and an
unacceptable cost becomes a follow-up (query rewrite), not part of this change. A chosen index must not regress the
thin DELETE or inserts. The after-plan must not depend on PG18-only btree skip scan; any skip-scan plan is called out.

**D5. Reproducible artifacts.** Commit `backend/scripts/perf/history-retention-measure.sql` (seed + measure). Its first
lines are `\set ON_ERROR_STOP on` and then a guard that aborts unless `current_database()` is exactly
`helio_hel1284_scratch` (a `DO ... RAISE EXCEPTION`, which with ON_ERROR_STOP ends psql with exit 3; not `\if`/`\quit`,
which exits 0) — plain psql continues after an error, so a guard without ON_ERROR_STOP protects nothing. The refusal
test against `helio` runs only under `PGOPTIONS='-c default_transaction_read_only=on'` and records: non-zero exit, a
marker line placed after the guard never printed, and `helio`'s `users`/`pipelines`/`output_snapshot_history` counts
identical before and after. Seeding uses `TRUNCATE ... CASCADE` between scenarios and seeds whatever parent rows the
schema's triggers/FKs require (e.g. `pipeline_roots`, V99). Measuring runs as `matt` (superuser, so RLS is bypassed
exactly as on the `helio_privileged` BYPASSRLS pool the tick uses); stated in the evidence. Raw plans and the summary table go in the
change's `measurements.md` (evidence), and the summary in the PR body.

**D6. Migration shape (only if D4 fires).** Plain `CREATE INDEX IF NOT EXISTS` inside Flyway's transaction, not
`CONCURRENTLY`, justified by the measured build time at S1/S2: prod history is days old (≤ S1), and the build's SHARE
lock only delays history inserts for that long. `CONCURRENTLY` would need a non-transactional Flyway script config and
can leave an INVALID index that `IF NOT EXISTS` then silently keeps; rejected unless the measured S2 build exceeds ~5 s.
Prod Flyway runs as the non-BYPASSRLS `helio` role (MISTAKES.md). `CREATE INDEX` needs table ownership, not BYPASSRLS.
That `helio` owns V115's table is an **assumption**: Flyway created it and no migration re-owns it. It is stated as such
and is not "proven" by any local run. If prod ownership can be read read-only, record it.

**D7. Cadence/lock verdict criteria.** Hourly is appropriate if the S2 tick wall time is well under the 120 s
lock-retry window and a small fraction of the interval. The lock is appropriate if each transaction's lock hold time
(D3) does not routinely starve run-side payload trims, which skip rather than wait. Report against these.

## Risks / Trade-offs

- [Local hardware/PG 18 ≠ prod] → state versions and settings; avoid PG18-only plan shapes in the decision (D4).
- [Server work is not niced by `nice psql`] → one session at a time, ≤2 parallel workers, seed in batches.
- [Payload purge cost includes FK `ON DELETE SET NULL` trigger time on `output_snapshot_history.payload_id`] → read it
  from the EXPLAIN ANALYZE `Trigger` lines and count it.
- [V120 merging before HEL-1347's V119 makes prod Flyway reject V119 later (resolved-but-not-applied lower version)] →
  if V120 ships, it must not merge until V119 is on origin/main; the PR states this and the pre-merge check verifies it.
- [sbt 2 leaves a server running after `sbt assembly`] → run `sbt shutdown` in `backend/` afterwards.
- [Disk: S2-owner ≈ 4–5 GB] → 69 GB free; drop the scratch DB at the end and confirm with `\l`.
- [Applying V120 to the shared dev DB if the dev server is started] → no UI/API change; do not boot the dev server
  against `helio` for this ticket. The one backend boot (D1) points only at the scratch DB.

## Planner Notes

- Self-approved: steady-state modelling instead of raw 105M rows (driver-directed); payload purge included in
  per-tick cost (round-1 design-gate revisions applied: tier mix, candidate pair, firing metric, per-transaction lock
  time, scenario isolation, Flyway mechanism) because it runs in the same gate (ticket predates HEL-1276); `skip_specs` since no behaviour changes.
