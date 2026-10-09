## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `8b6f78f86f6fc2fc0423b9e668f96a41d3218320`. Diff base, resolved live with `resolve-review-base.sh` (exit 0): `023aa4bbe4144436c871cdd41d57c71f2a275bb8`. origin/main is now `0a4badcf` (HEL-1347, V119).

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/measure-history-thinning-delete/HEL-1284`.
- **Diff scope:** `git diff 023aa4bb...HEAD --stat` shows 24 files. They are the measure script, `V120__history_retention_captured_at_indexes.sql`, and openspec artifacts and evidence. There is no Scala, API, schema or frontend change, so step 4 (UI) does not apply. I did not start the servers.
- **The script runs the real statements.** `backend/scripts/perf/history-retention-measure.sql` lines 218-283 match the code at this HEAD:
  - The history statements match `OutputHistoryRepository.scala:126-173` character for character in structure.
  - The payload statements match `NodePayloadHistoryRepository.scala:172-194`.
  - The bind values match the code defaults: `OutputHistoryRetentionConfig.scala:61-63` (30/90/365 days), `OutputHistoryRepository.scala:50-52` (24 h at 5 min, 7 d at 60 min, then 24 h buckets), `PayloadHistoryConfig.scala:44-45` (beta 10 runs/7 d, owner 30 runs/30 d), and the protected 101.
  - The unnamed-tier catch-all uses the strictest cap (30 d), which is correct.
- **measurements.md against the raw evidence.** I recomputed these from the scan nodes of each plan:
  - **S2 before, PG16 proxy:** free 316,648+4,670,000; beta 137,071+4,849,280; owner 17+4,986,230. That totals **14,959,246**, as claimed.
  - **S2 after V120, proxy:** `Index Scan using idx_output_snapshot_history_captured_at`, `Index Searches: 1`, with a plain `captured_at < cutoff` Index Cond (no skip scan). Rows read are 316,648+137,071+17 = **453,736**, as claimed.
  - **Candidate B:** free stays on a seq scan of 4,986,648 rows. Beta is 830 loops × 0.13 and owner is 166 × 0.10, about **4,986,772**, as claimed.
  - **`@@TX` lock holds:** the medians match every table, for example S2 proxy 9772.6 → 9068.9 ms, S1 787.2 ms, S2-owner 14624.0 ms and S3 17839.3 ms.
  - **`@@T` deleted counts:** these match too: 297/104/17/0/120000 at S2, 1,595,000 in the S3 thin, and 418 for the S2-owner owner purge.
  - **`@@ rows` lines:** these match section 3.1.
- **D4 decision under C1.** The decision was made on mixed-tier S2: the plans show 1169 free users out of 1667. It compares `(captured_at)` with `(pipeline_id, captured_at)`, and A dominates B on rows read, buffers and time in the committed plans. S2-owner was not used for the decision. The decision holds.
- **Prod PG version:** I ran the read-only `gcloud sql instances describe helio-db` myself. It returned `POSTGRES_16_14  db-g1-small`, so the PG16-proxy framing is grounded.
- **V120 is safe in prod:**
  - It contains two plain `CREATE INDEX IF NOT EXISTS` statements, with no `CONCURRENTLY`. That is valid inside Flyway's transaction on PG16.
  - Building an index needs table ownership, not BYPASSRLS, so the non-BYPASSRLS `helio` Flyway role is irrelevant to RLS here.
  - Ownership is corroborated by precedent: `V116__node_payload_history.sql:64` already ran `CREATE INDEX ... ON output_snapshot_history` through the same Flyway role. No migration re-owns either table: I grepped every migration for `OWNER TO`, and none of the hits touch these tables.
  - The new index names are unique.
  - V119 (data_sources/image_uploads FKs) touches other tables. Since V119 is now on origin/main, the merge-order precondition is met.
- **The gate, re-run by me.** I ran `nice -n 19 sbt "testOnly *OutputHistoryRetentionPrivilegedSpec *NodePayloadHistoryRetentionSpec"`, which uses embedded Postgres. Embedded Flyway logged `now at version v120`, and the result was `Total number of tests run: 10`, `Tests: succeeded 10, failed 0`, `All tests passed.`. I ran `sbt shutdown` afterwards. For the full suite I accept the evaluator's pasted output (6396 tests, 0 failed), since the change touches no Scala code.
- **C2/C3 hold:**
  - `pg_database LIKE 'helio%'` returns only `helio`, so the scratch DB is gone.
  - In `helio`'s `flyway_schema_history` (read-only session), `max(installed_rank)=119` and there are 0 rows for version 120. I checked both before and after my test run.

### Acceptance criteria

1. **EXPLAIN (ANALYZE, BUFFERS) of the thin and age-purge DELETEs at realistic volume: met.** The 10 evidence files hold run-1 plans and all timed passes for S1, S2, S2-owner and S3. The ticket's literal "1k × 1 year raw" example was modelled as the thinned steady state plus a 7-day backlog. The ticket's driver context explicitly directs this, and section 1 states it as a premise correction.
2. **Index if a DELETE full-scans where an index bounds it, with before and after plans and a coordinated number: met.** V120 is the number the driver assigned, and the before/after plans are committed and match the doc.
3. **Cost per tick and the cadence/lock verdict: met.** See sections 1 and 6: about 0.8 s at S1 and 9-10 s at S2, so hourly is appropriate. The lock is sound because a busy lock means skip, not wait. The prod slowdown factor is stated as an assumption.

### Verdict: CONFIRM

### Non-blocking notes

- **The V120 header (the evaluator's open question): not blocking.**
  - The "MUST NOT MERGE before HEL-1347's V119" line is a process instruction rather than a hazard. Still, nothing in it becomes false after merge: V119 does precede V120, so the line is accurate history. Its cost is noise, not misinformation.
  - The embedded numbers are dated measurements that carry the *why* (no index leads with `captured_at`, PG16 has no skip scan, plain beats CONCURRENTLY). CONTRIBUTING's comment standard allows that.
  - The `openspec/changes/<name>/measurements.md` pointer will dangle once the change is archived. That pattern already exists in V41, V92, V93, V101, V103, V105 and V106.
  - Trimming the header to the why is cheap now, since V120 has only been applied to throwaway databases. It would become impossible later, but it is a polish choice, not a defect.
- **Rebase onto origin/main (0a4badcf) before merging** so CI runs V119 and V120 together. The two migrations touch disjoint tables, so I expect no conflict.
- **Some section 4 numbers have no committed raw log:** the insert-path timings, the index build times (707 ms / 2,704 ms, and Flyway 0.772 s) and the "A and B both" row. The pick does not depend on them. The D6 plain-over-CONCURRENTLY rationale rests partly on the unpersisted build time, but the margin is large (5 s threshold) and the prod table is small. Label these figures "not persisted", or commit the log.
- **The payload "unreferenced" anti-join technically trips the D4 <1% rule** (2,820 read, 0 deleted at S2), and no index on the payload table can bound it. Section 4 could name it next to the thin and newest-N statements.
- **EXPLAIN medians can't be checked from the evidence.** The files hold only run-1 plans; the plain-pass and `@@TX` medians are fully checkable.
