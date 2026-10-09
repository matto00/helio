## Standing Constraints

- [C1] The V120 index decision is made only on the mixed-tier S2 scenario, by rows read from the target table versus rows actually deleted per statement, comparing at least (captured_at) and (pipeline_id, captured_at); never on all-owner data.
- [C2] Seed and measure only in `helio_hel1284_scratch`; never write to the shared `helio` DB; drop the scratch DB by exact name; never drop `helio_privileged`. The measure script runs against `helio` only for its read-only refusal test (D5).
- [C3] Never migrate or boot via `sbt run` or anything that reads `backend/.env`; Flyway runs only via jshell on the assembly jar, as role `matt`, with a literal scratch URL (design D1).

## 1. Backend: scratch database and seed

- [x] 1.1 Create `helio_hel1284_scratch`; migrate it via `sbt assembly` + jshell on `helio-backend.jar` as role `matt` with a literal scratch URL (D1, never `sbt run`); record the MigrateResult database/version and the installed_on window checks on scratch and `helio`
- [x] 1.2 Write `backend/scripts/perf/history-retention-measure.sql` starting with `\set ON_ERROR_STOP on` + a `current_database()` guard (D5); verify refusal against `helio` only under `PGOPTIONS='-c default_transaction_read_only=on'`: non-zero exit, post-guard marker absent, helio counts unchanged
- [x] 1.3 Seed each scenario (S1, S2, S2-owner, S3; D2) one at a time (truncate, seed, VACUUM ANALYZE) under `nice -n 19`, ≤2 workers; verify row counts, rows per Output by tier, and mix with recorded queries

## 2. Backend: measure (before)

- [x] 2.1 Capture `EXPLAIN (ANALYZE, BUFFERS)` (BEGIN/ROLLBACK, median of 3) of every retention DELETE in both repositories, exact origin/main statement text, per scenario; record plans, rows read vs deleted, timings
- [x] 2.2 Time each repository transaction separately (lock hold) and their sum (tick wall time) per scenario; record PG version, `work_mem`, parallel settings, and the prod PG major version if obtainable read-only (else state unknown)

## 3. Backend: index (only if design D4 fires)

- [x] 3.1 Add `V120__<name>.sql` (plain `CREATE INDEX IF NOT EXISTS`, commented rationale); verify the measured S1/S2 build time supports plain over CONCURRENTLY (D6)
- [x] 3.2 Apply V120 to the scratch DB with the same jshell Flyway call and verify it lands as version 120; record measured build time at S1/S2
- [x] 3.3 On S2 compare `(captured_at)` vs `(pipeline_id, captured_at)` (D4), then re-capture the after plans for every DELETE plus an insert-path timing; verify the target DELETEs are index-bounded and the thin DELETE did not regress

## 4. Backend: verdict and cleanup

- [x] 4.1 Write the per-tick cost, extrapolation assumptions, and cadence/lock verdict (design D7) into measurements.md
- [x] 4.2 Drop `helio_hel1284_scratch` (and any temporary role) by exact name; verify via `\l` / `\du`

## 5. Tests

- [x] 5.1 If V120 exists: run the existing retention/history test suites green via `sbt testFull` (or a filtered run whose executed test count is recorded and non-zero)
