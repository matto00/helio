## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `22fe13bb78e7838cfe7e8a3ebe217b710025e871`. The review base was resolved live with `resolve-review-base.sh` to `df5c941e658d5dcb63656a671437bc037f29b3ed` (origin/main), exit 0. The change is backend-only: no `frontend/**` files, so the UI step does not apply.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/bounded-history-thinning-batches/HEL-1435`.

**Production calls the bounded path only.**
- The only repository call in `backend/src/main` is `OutputHistoryRetentionService.scala:65`, which calls `repo.thinPass(..., config.thinLimits, cursor.get(), ...)`.
- `Main.scala:290-291` builds the service with `OutputHistoryRetentionConfig.fromEnv()`, which now reads the three `OUTPUT_HISTORY_THIN_*` variables.
- `thinAndPurge` remains in main code as a drain wrapper. Its only callers are under `src/test`: OutputHistoryRepositorySpec, RetentionLockGuardSpec, HistoryBaselineAfterThinningSpec and OutputHistoryBatchedThinSpec.

**Which rows survive (traced by hand, not taken from the narrative).**
- *Oracle is verbatim.* The SQL in `OldSingleStatementThin` is text-identical to the `thinAndPurge` body this diff removes. I compared both age purges (named and unnamed) and the two-`row_number` thin, side by side in `git diff df5c941e6...HEAD`.
- *Rank once is equivalent.*
  - The old code deletes `rn > 1` within `(output, age_class, floor(epoch/bucket_secs))` among rows with `recency > protectedNewest`.
  - The new code deletes `recency > protectedNewest+1 AND prev_class = age_class AND prev_bucket = bucket`, using `lag` over the same `PARTITION BY output_id ORDER BY captured_at DESC, id DESC`.
  - Ordered newest first, `age_class` never decreases and `floor(epoch/b)` never increases within a class, so each group is contiguous. Rows with equal `captured_at` fall in the same group.
  - The row at `recency = protectedNewest+1` is always the newest unprotected row of its group (its predecessor is protected), so the new code always keeps it. For deeper rows the predecessor is unprotected, so "same group as predecessor" is equivalent to "`rn > 1`".
  - The bucket expression has the same numeric/bigint types as the old one.
- *Age purge is equivalent.*
  - The new code computes `COALESCE(cutoffs[array_position(tiers, u.tier)], strictest)`. The old code ran a named purge per tier plus `<> ALL` at the strictest cap. These differ only when `u.tier` is NULL, and `users.tier` is `NOT NULL` (V88:13).
  - The extra predicate `captured_at < strictest` is implied by every tier's cutoff.
  - Batches are made of whole Outputs, and the FK `output_snapshot_history.output_id → outputs(id) ON DELETE CASCADE` (V115) guarantees no orphaned history row is missed by the keyset over `outputs.id`.

**Equivalence at scale.**
- 12 `survivor-diff-*.log` files cover S2, S3 and S4 × desktop/prod-io-base × R=25,000/100,000.
- Every `EXCEPT` row in them is `0`: 48 zero-count rows, and no non-zero ones.
- S4 prod-io-base R=25,000 has 141,000 survivors on each of old, new1 and newM. Total deletions are identical: 5,392,209, in both `drain-old` and `drain-new-M1`.

**Rank once and plan acceptance, checked in the raw `auto_explain` dumps.**
- Every R=25,000 and R=100,000 `dry-S{2,4}-*.server.log`, across all profiles, has 0 `Seq Scan on output_snapshot_history`.
- `Delete on output_snapshot_history` plans are present (12 on S2 and 24 on S4 for prod-io-base R=25,000).
- The thin plan has one Sort and one WindowAgg (a quicksort of 2.1 MB) over a Bitmap Index Scan restricted to `output_id = ANY(batch)`.
- At R=250,000 there are 9 Seq Scans, as measurements.md §6.1 states.
- The old plan has 6 Seq Scans, and `old-S2-desktop.tempfiles.log` shows temporary files being written.

**The pass-stall figures (96.7 s, 0.88×) are honest.**
- I recomputed them myself with awk from the `@@PASS ... ms=` lines of the `drain-new-M1-*-R25000.log` files, using a sliding sum of 20 consecutive batches.
- Results: S2 desktop 3.8 / 0.35 s, S2 prod-io-base 5.6 / 0.72 s, S3 desktop 3.5 / 0.30 s, S3 prod-io-base 5.2 / 0.37 s, S4 desktop 18.4 / 3.07 s, S4 prod-io-base **96.7 / 8.04 s**. These match `pass-window-analysis.txt` and §10 exactly.
- The old-tick value is in `drain-old-S4-prod-io-base-R25000.log`: `ms=109627.0`.
- measurements.md does not hide the costs:
  - total work rises 5.4× on S4 prod-class;
  - a pass blocks the scheduler tick (I confirmed this at `PipelineSchedulerService.scala:127`, where `historyWork` is zipped into the tick future);
  - the cold strict-IO model breaks the 1–2 s target;
  - the D5 deviation is stated.

**The prod-class proxy is justified (AC 3).**
- §3 labels every hardware figure that was not measured as an ASSUMPTION, recalled rather than fetched, with a URL.
- Each has a sensitivity bracket: CPU 0.5/1.0, shared_buffers 128 vs 570 MB, IO base/strict, and cached vs `debug_io_direct`.
- `io-probe.log` shows the throttle bites.
- The tier, version and disk are cited to the real instance via HEL-1284.
- The assumed 3–10× is replaced by measured 2.1× (warm), 6.6× (strict, cached) and 120× (strict, cold).

**AC 4 evidence gaps are closed.**
- `v120-insertpath-{desktop,prod-noio,prod-io-base}.log` are committed and labelled as fresh PG16 re-runs (C4).
- All EXPLAIN runs are committed: the `old-*.log` files and every `dry-*.server.log`.
- §8 states that the payload "unreferenced" DELETE is an anti-join over every payload row and cannot be bounded by an index, with a measured 8.3 ms.

**Service precedence matches D4.** The service sets `nextDue` as follows:

| Condition | Next due |
|---|---|
| Any part busy, none failed | `lockRetry` |
| More work, none failed | `Some(now)`, i.e. the next tick |
| Any failure | the claimed interval |

The cursor resets on `Completed`, is kept on failure, and is taken from `LockHeld.resumeAfter` when the lock was held.

**Tests are real reds, not vacuous.**
- The committed red and mutation logs show `*** FAILED ***` for:
  - the protected count off by one, which fails the guard;
  - dropping the bucket comparison (3 failed);
  - a stub that ignores the budgets (3 failed);
  - the mid-pass lock mutation `LockHeld(0, startAfter)`;
  - D10 (i), a waiting trim lock;
  - D10 (ii), the age DELETE in its own transaction.
- The randomized guard covers 12 fixtures × protected counts {0, 5, 101} × 6 batch shapes, with captured_at ties, 0–260 rows per Output (so they straddle 101), and three cap maps.

**Gates re-run fresh by me.** I ran `nice -n 19 sbt -J-Xmx3g "testOnly OutputHistoryBatchedThinSpec OutputHistoryRetentionServiceSpec OutputHistoryRetentionConfigSpec *RetentionLockGuardSpec *PipelineSchedulerServiceMaintenanceHooksSpec *OutputHistoryRepository*"`. The test JVM forked fresh: logback initialised at 07:51 during this run.
- Result: `Suites: completed 6, aborted 0`, `Tests: succeeded 54, failed 0`, `All tests passed.`
- `grep` found no `TESTS FAILED` or `*** FAILED`.
- I ran `sbt shutdown` afterwards.
- For the full suite I rely on the evaluator's pasted cycle-2 `testFull` result (6655 succeeded, 0 failed) at `fec25bed5`. The backend is byte-identical since then: cycle 3 touched no `backend/` files, which the evaluator verified.

**Constraints C1–C5.**
- C1: `teardown.log` records exact-name teardown.
- C2: I followed it myself.
- C3: the NOWAIT 55P03 precondition is covered by the D10 (ii) log.
- C4: §9 and §11 carry the required labels.
- C5: the test asserts that the fifth batch is empty.

**Gate-defect check (CON-160).** No load-bearing claim here rests on mtime ordering. The evaluator flagged one unverifiable aside ("the first clone was the colder run"); no figure depends on it, and this gate does not rely on it.

### Verdict: CONFIRM

### Non-blocking notes
- **Dangling pointer after archive.** The CLAUDE.md row for `OUTPUT_HISTORY_THIN_BATCH_ROWS` points at `openspec/changes/bound-history-thinning-batches/measurements.md`. The archive step moves that file to `openspec/changes/archive/<date>-bound-history-thinning-batches/`, so the row should be rewritten when archiving.
- **Scheduler stall during a deep-backlog drain.** On the prod-class proxy, every tick is extended by up to about 92 s for roughly 15 consecutive passes, where today there is one 110 s stall per hour. The worst single stall is lower, but the duty cycle is higher. This is disclosed. A per-pass wall-clock budget, or moving the thin off the tick, is worth a follow-up ticket, as the evaluator also suggested.
- **Test-only method in production code.** `thinAndPurge` is a test-only drain that lives in production code. It is documented as such, but it is an unbounded-wall-clock entry point that a future caller could misuse. Consider moving it into test support.
- **Weak assertion.** The "split batches on the row limit" test asserts only `>= 2` batches carrying seeded Outputs; it is a weak pin.
