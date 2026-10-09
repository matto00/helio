## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `8b6f78f86f6fc2fc0423b9e668f96a41d3218320`. Diff base, resolved live: `023aa4bbe4144436c871cdd41d57c71f2a275bb8`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- **AC1 (EXPLAIN ANALYZE BUFFERS of the thin and age-purge DELETEs at realistic volume, with plans and timings): met.**
  I diffed every statement in `history-retention-measure.sql` against `OutputHistoryRepository.scala:129-173` and
  `NodePayloadHistoryRepository.scala:172-194`. The SQL text matches, including the 101-row protected recency and the
  300/3600/86400 bucket defaults. Plans are in `evidence/*.txt`: 11 statements per file, run 1, plus all 3 timed passes.
  The ticket's "1k × 1 year raw" example was modelled as thinned steady state plus a 7-day backlog (S3). The driver
  directed this, and measurements.md section 1 states it as a premise correction.
- **AC2 (add an index if a DELETE full-scans where an index would bound it; show before/after plans; migration number
  agreed with the driver): met.** V120 is the number the driver assigned. I checked the before/after numbers against the
  raw plans:
  - **Before, PG16 proxy** (`S2-before-pg16-proxy.txt`): free purge reads 316,648 rows + 4,670,000 removed by filter
    = 4,986,648 rows read, 297 deleted. Beta reads 137,071 + 4,849,280 = 4,986,351 rows, 104 deleted. Owner reads
    17 + 4,986,230 = 4,986,247 rows, 17 deleted. Total 14,959,246 rows read, matching measurements.md.
  - **After** (`S2-after-v120-pg16-proxy.txt`): `Index Scan using idx_output_snapshot_history_captured_at`, Index
    Searches 1. Rows read are 316,648, 137,071 and 17, for 453,736 in total. That matches.
- **AC3 (cost per tick; whether the hourly cadence and advisory lock still fit): met** (measurements.md sections 1 and 6).
  I checked the `@@TX` medians against the evidence:
  - S2 after, proxy: 9074.55 / 9068.85 / 9036.02 ms, median 9068.9.
  - S2 before, proxy: 9772.6 ms.
- **D4 rule applied as written on mixed-tier S2 (C1): yes.**
  - The S2 seed is mixed: `@@ rows` shows 4,986,648 history rows. The plans show users 1169 free and 498 non-free, out
    of 1667.
  - The decision compares `(captured_at)` with `(pipeline_id, captured_at)` on the three named-tier purges.
  - Candidate B's rows read from `S2-candidateB-…txt`:
    - free: seq scan of 4,986,648 rows;
    - beta: 830 loops × 0.13 rows ≈ 107;
    - owner: 166 loops × 0.10 rows ≈ 17.
  - That totals 4,986,772, as stated. Candidate A's total is 453,736.
  - A wins on rows read, buffers and time. S2-owner was not used for the decision.
- **Prod PG version claim: verified.** A read-only `gcloud sql instances describe helio-db` returns `POSTGRES_16_14
  db-g1-small`. CI also uses `postgres:16` (`.github/workflows/ci.yml:517`).
- **PG16-proxy validity: acceptable, with its caveats stated.** Dropping the leading-column indexes inside each
  rolled-back transaction stops the planner from using PG18 skip scan. measurements.md section 2 says correctly that real
  PG16 could pick a full-index scan instead. That read would still be roughly the whole relation, so the D4 outcome does
  not change. The after-plan uses a plain range condition with `Index Searches: 1`, so it does not depend on skip scan.
- **Tasks:** every item is checked and matches the diff. There is no scope creep: no Scala, API, schema or frontend
  change.
- **Constraints C1–C3:**
  - Scratch DB is gone. `psql -l` shows no `helio_hel1284_scratch`, and `pg_database LIKE 'helio%'` returns only `helio`.
  - `helio` is untouched: its `flyway_schema_history` head is still rank 119, with 0 rows for version 120. I checked
    this before and after my own gate run.
  - The C3 mechanism (jshell Flyway, never `sbt run`) is recorded in measurements.md section 2.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Gate, re-run by me:** `nice -n 19 sbt testFull` in the worktree (`backend/**` changed) passed:
  - `Total number of tests run: 6396`, `succeeded 6396, failed 0, canceled 4`, `All tests passed.`, exit 0.
  - Embedded Postgres logged `now at version v120`.
  - Retention and payload-history specs ran: 38 log hits.
  - `sbt shutdown` was run afterwards.
- **Prettier:** `npx prettier --check` on the changed md/yaml files is clean. No frontend files changed, so the frontend
  gates do not apply.
- **V120 is safe as a plain in-transaction `CREATE INDEX`:**
  - Both statements are plain `CREATE INDEX IF NOT EXISTS` with no `CONCURRENTLY`, so they are valid inside Flyway's
    transaction on PG16.
  - The new index names are unique across all migrations.
  - `CREATE INDEX` needs table ownership, not BYPASSRLS. No migration runs `ALTER ... OWNER TO` on either table.
  - V116 (`V116__node_payload_history.sql:64`) already ran `CREATE INDEX idx_output_snapshot_history_payload ON
    output_snapshot_history` through the same Flyway role. That is the same operation on the same table, which
    corroborates the stated ownership assumption.
  - Build time was about 0.7 s at 5M rows (Flyway reported 0.772 s for both indexes). That is well under the D6 5 s
    threshold, so plain over CONCURRENTLY is justified.
- **Measure-script guard is correct:**
  - Line 21 is `\set ON_ERROR_STOP on`. Next comes `DO $guard$ … RAISE EXCEPTION` on `current_database() <>
    'helio_hel1284_scratch'`, then `\echo MARKER_AFTER_GUARD`.
  - There is no `\c`/`\connect` and no `DROP DATABASE`/`ROLE`.
  - The only `DROP` statements are `DROP TABLE IF EXISTS perf_anchor`, `DROP INDEX IF EXISTS perf_*` on scratch-only
    names, and the pg16-view `DROP INDEX` inside `BEGIN … ROLLBACK`. All of these come after the guard.
  - `TRUNCATE` also comes after the guard.
  - The recorded refusal test reports exit 3 and 0 marker lines, run under `default_transaction_read_only=on`.
- **Mechanical rules:** CONTRIBUTING's mechanical checks (scala-quality, credential leak) do not touch `.sql`/`.md`.
  There are no violations.

### Phase 3: UI Review — N/A
None of the Phase 3 triggers matched (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). As
instructed, I did not start the dev server or backend; starting the backend would apply V120 to the shared `helio`.

### Overall: PASS

### Non-blocking Suggestions
- **Insert-path, build-time and "A and B both" numbers have no committed raw evidence.** These are the section 4 rows:
  - 10k/120k-row insert timings;
  - the 707 ms / 2,704 ms builds;
  - the A+B row.

  `grep @@INS evidence/*` finds nothing, and no evidence file has both index sets. The A-over-B pick does not depend on
  them, because A dominates B on rows read, buffers and time in the committed plans. Still, D4 lists insert cost as a
  pick input, and these figures are currently assertions. Either commit the insert-path log or label these figures as
  not persisted.
- **EXPLAIN medians cannot be checked from evidence.** The tables report "EXPLAIN exec ms (median of 3)", but `evidence/`
  holds only run-1 plans. Plain-pass medians can be checked, because all three `@@T`/`@@TX` passes are committed. Saying
  so in section 8 would help.
- **D4 rule technically fires on the payload "unreferenced" DELETE.** On S2 it reads 2,820 rows and deletes 0. This is
  an anti-join that no payload-table index can bound. measurements.md section 4 lists the thin and newest-N as
  non-boundable but does not name this one. Add one line.
- **V119 has merged.** origin/main is at `0a4badcf` (HEL-1347, V119), so V120's merge-order precondition is now met.
  - The branch is still based on `023aa4bb` and has never been tested with V119 present. Rebase onto origin/main before
    merging. The two migrations are independent tables, so a conflict is not expected.
  - The V120 header lines "MUST NOT MERGE before HEL-1347's V119…" are a process instruction that becomes permanent noise
    in an immutable migration. It is cheap to reword now, since V120 has only been applied to throwaway databases.
- **V120's header comment is long (21 lines) and embeds measured numbers that will go stale.** Per CONTRIBUTING
  "Comments", consider keeping the why (no index leads with `captured_at`; PG16 has no skip scan; plain beats
  CONCURRENTLY) and leaving the numbers in measurements.md.
