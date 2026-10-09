## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD `023aa4bbe4144436c871cdd41d57c71f2a275bb8` (= origin/main). The only change is the untracked change dir.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/measure-history-thinning-delete/HEL-1284`.
- **Round-3 CR1 (assembly jar instead of sbt export): applied and sound.**
  - D1 and task 1.1 now name `nice -n 19 sbt assembly` plus `jshell --class-path <worktree>/backend/target/scala-2.13/helio-backend.jar`. `build.sbt:89` pins exactly that output path.
  - The merge strategy concatenates `META-INF/services` (build.sbt:93), which keeps Flyway's plugin registration.
  - `envVars`/`loadDotEnv` is wired only to `Compile / run` and `Test` (build.sbt:124-125), so `assembly` never evaluates `.env`.
  - The wording "No task that loads `.env` is invoked" addresses round 3's note.
- **Round-3 CR1 (concrete role `matt`): verified against ground truth.** I ran read-only queries on `helio`.
  - `flyway_schema_history` returned `matt|119`: every row has `installed_by = matt`.
  - `pg_roles` shows `matt` is a superuser, so V34's `GRANT helio_privileged TO current_user` is a no-op for it.
  - I grepped V1..V118 for cluster-global DDL. The only cluster-level effects are V34's idempotent role create and that GRANT (`CREATE ROLE ... IF NOT EXISTS` via `pg_roles`).
  - `.dataSource(url, "matt", "")` will authenticate. With `PGPASSFILE=/dev/null` and `-w`, psql connected over both `::1` and `127.0.0.1` without a password (trust auth).
- **Migration numbering.**
  - The worktree has 118 contiguous migration files, ending at V118. `helio` is at 119 (HEL-1347, local).
  - After a fresh `git fetch`, no remote branch carries V119 or later, so V120 matches the driver's assignment.
- **Statement inventory against the code.**
  - `OutputHistoryRepository.thinAndPurge` (OutputHistoryRepository.scala:119-184) contains:
    - the per-named-tier `USING pipelines p, users u` age purges;
    - the `<> ALL(string_to_array(...))` catch-all;
    - the thin DELETE with a double `row_number()` and protected newest-N;
    - all of it under `pg_try_advisory_xact_lock`, `transactionally`, on `withSystemContext`.
  - `NodePayloadHistoryRepository.purge` (lines 168-204) contains the disallowed, per-tier age, per-tier newest-N and unreferenced purges, run as a separate guarded transaction.
  - design.md's Context matches all of this. Its index inventory also matches V115/V116: `(output_id, captured_at DESC)`, partial `(payload_id)`, and the payload `(pipeline_id, node_step_id, root_id, captured_at DESC)`. `output_snapshot_history.pipeline_id` exists (V115), so the `(pipeline_id, captured_at)` candidate is well-formed.
- **D2 arithmetic.**
  - Rows per Output: owner 288+144+358 = 790, beta 288+144+83 = 515, free 288+144+23 = 455.
  - S1 under mix M: 1000 × (0.7·455 + 0.25·515 + 0.05·790) ≈ 0.49M. S2 ≈ 4.9M. S2-owner ≈ 7.9M. S3 = 1000 × 2016 ≈ 2.0M.
  - The 101 protected points span about 8.4 h at a 5-minute cadence, so they fall inside 24 h as claimed.
  - Seeding "as of now − 1 h" gives the thin DELETE its real hourly work (about 11 per Output at the 24 h boundary).
- **RLS during measurement.**
  - V115/V116 use `FORCE ROW LEVEL SECURITY`. Prod runs these statements as BYPASSRLS `helio_privileged`. Superuser `matt` also bypasses RLS, so the plans are comparable.
- **AC coverage.**
  - AC1 (plans and timings at volume) is covered by 2.1-2.2.
  - AC2 (conditional index, before/after, V120) is covered by 3.1-3.3, with C1.
  - AC3 (per-tick cost, cadence/lock verdict) is covered by 2.2 and 4.1 (D7).
  - I found no placeholders or TBDs. The proposal, design and tasks are consistent.
- **Task 5.1 safety.** No file under `src/test` references `DATABASE_URL` or `localhost:5432/helio`, so `sbt testFull` loading `.env` does not touch the shared DB.
- **New finding, missed by rounds 1-3: the D5 guard plus task 1.2 can seed the shared `helio` DB.**
  - D5 requires the committed script to "refuse to run unless `current_database()` is exactly `helio_hel1284_scratch`". Task 1.2 requires verifying that "it refuses to run against `helio`", which means deliberately executing the seed script against the shared DB.
  - Neither says how the guard stops execution. The natural implementation is a `DO $$ ... RAISE EXCEPTION $$` block, and under psql's default (no `ON_ERROR_STOP`) that does not stop the script.
  - I reproduced this read-only against `helio`, using a scratchpad file holding exactly such a guard followed by `SELECT 'CONTINUED_AFTER_GUARD'`. psql printed `ERROR: refusing: helio`, then executed the next statement and printed `CONTINUED_AFTER_GUARD`, and exited with status `0`.
  - So a plausible guard passes a superficial "it printed refusing" check while every following seed statement runs against `helio` as a superuser. That breaks C2 and the ticket's driver constraint.
  - The exit status of 0 means even an exit-code check would not catch it.
  - I also confirmed that `PGOPTIONS='-c default_transaction_read_only=on'` makes such a session refuse writes (`cannot execute CREATE TABLE in a read-only transaction`, exit 1). That gives a structurally safe way to run the refusal test.

### Verdict: REFUTE

The round-3 CR is correctly applied, and the measurement design, decision rule and AC coverage are sound. One defect remains on the plan's most important safety property (C2). The committed script's guard mechanism is unspecified, and task 1.2 then deliberately runs that script against the shared `helio` DB. psql's default error handling turns the most natural guard into a no-op that exits 0, which I reproduced. The fix is a few lines in D5 and task 1.2.

### Change Requests

1. **D5 and task 1.2: make the guard fail-stop by construction, and make the refusal test unable to write to `helio` even if the guard is wrong.**
   - (a) D5 must specify that the script's first lines are `\set ON_ERROR_STOP on` followed by the `current_database()` check. The check can be a `DO ... RAISE EXCEPTION`, or `SELECT current_database() = 'helio_hel1284_scratch' AS ok \gset` followed by `\if :ok \else \echo refusing \quit \endif`. The script itself must stop, rather than relying on the caller passing `-v ON_ERROR_STOP=1`.
   - (b) Task 1.2's verification must run against `helio` only under `PGOPTIONS='-c default_transaction_read_only=on'`. It must record a non-zero exit status, record that no statement after the guard executed (for example, a sentinel `\echo` placed after the guard is absent from the output), and record that `helio`'s `users`/`pipelines`/`output_snapshot_history` counts are unchanged before and after.
   - (c) Add one line to C2 stating that the seed script never runs against `helio` except under (b).

### Non-blocking notes

- **D3: state the measuring role.** Measure as `matt` (superuser) or under `SET ROLE helio_privileged`, so RLS is bypassed as in prod. With `FORCE ROW LEVEL SECURITY`, a non-bypass role would add a `helio_can_access_pipeline()` filter and distort every plan.
- **Payload seed: state the payload JSON size distribution.** A DELETE of TOASTed payloads costs TOAST deletes. Also note in the evidence that deleting `node_payload_history` rows fires the `payload_id ... ON DELETE SET NULL` FK trigger against `output_snapshot_history`. EXPLAIN ANALYZE prints trigger time separately, so include it in the per-statement cost.
- **Seeding mechanics.**
  - `TRUNCATE users` without `CASCADE` fails, because other tables reference `users`.
  - V99's `hel913_prevent_zero_root_pipelines_trigger` requires `pipeline_roots` rows for seeded pipelines.
  - Both are executor-level issues, not design defects. Using `TRUNCATE ... CASCADE` in the scratch DB is fine once CR1's guard is in place.
- **D6 threshold.** The CONCURRENTLY threshold is applied to the S2 build time, while the justification is prod ≈ S1. That is conservative and acceptable. Record both build times as the task says.
- **Driver coordination.** If V120 merges before HEL-1347's V119, prod Flyway (`outOfOrder` false) will reject V119 later. The driver owns that ordering; mention it in the PR body.
- **sbt hygiene.** Round 3 suggested keeping `sbt --client shutdown` / no-lingering-server hygiene after `sbt assembly`. It is still not mentioned. This is optional.
