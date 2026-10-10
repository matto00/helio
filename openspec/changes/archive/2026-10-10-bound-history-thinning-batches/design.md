## Context

See proposal.md (Why). Today (origin/main 22f4c1fd3) `OutputHistoryRetentionService.purgeIfDue` claims a slot per
`OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES` (60) and calls `OutputHistoryRepository.thinAndPurge`: ONE transaction on the
privileged pool that takes `pg_try_advisory_xact_lock(0x48454C31323732)`, runs the per-tier age purges (index-bounded
since V120), then the thin DELETE: `row_number()` over every row per Output (recency, protect newest 101), then a
second `row_number()` per `(output, age_class, bucket)`, delete `rn > 1`. Then `NodePayloadHistoryRepository.purge`
(own transaction, same lock). HEL-1343: a `LockBusy` part shortens the next due to `lockRetry` (120 s); a failure keeps
the full interval. `output_snapshot_history.output_id` has an FK to `outputs(id) ON DELETE CASCADE`, and the index
`(output_id, captured_at DESC)`. Spec: `openspec/specs/output-history-retention/spec.md`.

## Goals / Non-Goals
Goals: per-transaction thin work bounded by a row budget (rows ranked per statement ≤ max(R, rows of the single
largest admitted Output)), independent of table size and of backlog depth spread over many Outputs; the one residual is
a single Output's own row count (quantified, D9); bounded catch-up; real-PG16 measurements on a justified proxy. Non-goals: any change to which rows survive (proposal).

## Decisions

**D1. Batch by Output, keyset over `outputs.id`, admitted by a row budget.** Candidates = `SELECT id FROM outputs
WHERE id > $cursor ORDER BY id LIMIT $n` (PK-bounded on PG16; `outputs` is small). Outputs are admitted in that order
while the running total of their history rows stays ≤ R (`OUTPUT_HISTORY_THIN_BATCH_ROWS`), each count bounded by an
index-only `LIMIT` of the remaining budget (`SELECT count(*) FROM (SELECT 1 FROM output_snapshot_history WHERE
output_id = $o LIMIT $remaining+1) x`), so admission reads ≤ R+1 index entries per batch plus ≤ N PK probes. The first
candidate is always admitted, even if it alone exceeds R (a batch is never empty: per-Output is the floor). Then one
DELETE restricted to `output_id = ANY($batch)` BOTH on the DELETE target (`DELETE FROM output_snapshot_history WHERE
output_id = ANY($batch) AND id IN (...)`) and in the innermost ranking scan, so neither side can Seq Scan the table
(HEL-1284's plan used a Hash Semi Join over a full target Seq Scan). Plan acceptance: on S2 and S4, both profiles, no
batch statement's plan contains `Seq Scan on output_snapshot_history`. N stays as an upper cap on Outputs per batch.
The last batch of a cycle (fewer than N candidates and none left) returns `resumeAfter = None` (no extra empty pass). Every
window in the thin is `PARTITION BY output_id`, so restricting the input to whole Outputs cannot change any Output's
result: per-Output batching is semantically exact by construction. Alternative rejected: `SELECT DISTINCT output_id
FROM output_snapshot_history` keyset — on PG16 (no skip scan) that reads the whole index each batch. The FK cascade
guarantees no history row has an Output missing from `outputs`.
**D2. Rank once.** Within an Output ordered `captured_at DESC, id DESC`, `age_class` is monotone in `captured_at` and
`floor(epoch / bucket_secs)` is monotone within a class, so each `(age_class, bucket)` group is contiguous. Hence
"`rn > 1` among unprotected rows of its group" ⇔ "`recency > 101` AND the immediately newer row (`lag` over the same
window) has `recency > 101` AND the same `(age_class, bucket)`". One window (`row_number` + `lag` over one
`PARTITION BY output_id ORDER BY captured_at DESC, id DESC`) means one sort. The `age_class`/`bucket_secs` CASE
expressions and bind parameters are kept textually identical to today's. If the executor finds an equivalence
counterexample (D6), it falls back to today's two-`row_number` SQL restricted per batch (still bounded) and records
why; "rank once" is then reported as not achieved, never silently dropped.

**D3. One transaction per batch, try-lock per batch.** Each batch (age purge + thin, see D4): its own transaction that first takes the same try-only xact lock; `false` stops the pass
(`LockBusy`, cursor kept, committed batches stay). The lock is now held for one batch, not the whole thin, so a
run-side payload trim (HEL-1333) is skipped only while one batch holds it. `SET LOCAL work_mem` only if D7 measures a per-batch
temp spill at the chosen batch size; value and reason recorded.
**D4. Bounded pass + continuation.** `thinAndPurge` gains `batchOutputs`, `batchRows`, `maxBatches`, `startAfter: Option[String]`
and returns, for the history part, deleted count plus `resumeAfter: Option[String]` (None = cycle complete). Exact
type shape is the executor's choice (e.g. a history-specific outcome), but `NodePayloadHistoryRepository`'s contract is
unchanged. A pass has two parts: history batches (age purge + thin per batch), and the payload purge (every pass,
regardless of the history parts' outcome, exactly as the service does today; tens of ms, bounded by tier caps).
**Age purge folded into each batch (no separate age phase).** Each batch transaction, after the try-lock, first
runs the tier age purge restricted to the batch: `DELETE FROM output_snapshot_history h USING pipelines p, users u
WHERE h.output_id = ANY($batch) AND h.pipeline_id = p.id AND p.owner_id = u.id AND h.captured_at < CASE u.tier WHEN
<named tier> THEN <its cutoff> ... ELSE <strictest cutoff> END` (one CASE arm per `maxAgeByTier` entry, ELSE = today's
unnamed-tier catch-all; empty map ⇒ no age DELETE), then the thin over the same batch. Reads are bounded by the batch's
rows through `(output_id, captured_at DESC)` (no cross-tier residue). Age-then-thin order matches today. Equivalence holds
row by row (the age predicate reads only that row's own pipeline owner's tier) and the thin is per-Output. Admission (D1) counts all of an Output's rows, over-age included.
Reference time: every statement in a pass uses that pass's `now`; an Output is age-purged and thinned at the `now` of
the pass whose batch covers it. Age-cap enforcement for an Output may lag by up to the length of a drain (stated in measurements.md). Next-due PRECEDENCE, evaluated over all parts
of the pass: (1) any part raised an error → `now + purgeInterval` (HEL-1343 / service contract; cursor kept);
(2) else any part lock-held → `now + lockRetry` (cursor kept); (3) else thin budget exhausted with Outputs remaining →
due on the next scheduler tick; (4) else (cycle complete) → `now + purgeInterval`, cursor reset to None. The cursor
lives in the service, in-process like `nextDue`; lost on restart = restart from the first Output (thin is idempotent).
One pass uses one `now` for all its batches; a later pass of the same cycle uses its own later `now`, which is
per-Output identical to a one-shot thin at that later time (stated in spec and measurements.md).

**D5. Configuration.** `OUTPUT_HISTORY_THIN_BATCH_OUTPUTS` (N), `OUTPUT_HISTORY_THIN_BATCH_ROWS` (R),
`OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS` (M) in `OutputHistoryRetentionConfig` via the existing `positive(...)`
helper; defaults chosen by D7's measurement with stated criteria: one batch of R rows ≤ ~1–2 s and temp ≤ a stated
small bound on the prod-class proxy (incl. deep backlog); one pass covers 10k Outputs at steady state. Documented in CLAUDE.md's env table. No migration (V122 stays free).

**D6. Equivalence proof (two layers).** (a) Scala, embedded Postgres: the old single-statement SQL is kept VERBATIM as
a test-only oracle; randomized fixtures (several Outputs and tiers, all three age classes, captured_at ties, points
on both sides of the 101 boundary, bucket-straddling) are thinned by the oracle and by the batched implementation with
batch sizes 1/2/3/large and small budgets run to completion; surviving id sets must be equal. It is a guard (passes on
old and new); prove it failable by a recorded mutation (protected count 100, or `recency >= 101`; NOT "lag compares
only bucket", a near-equivalent mutant).
(b) Scratch DB at scale, END TO END: on S2, S3 and S4 seeds that have NOT been age-purged, clone the seeded DB twice
(`CREATE DATABASE hel1435_old/hel1435_new TEMPLATE helio_hel1435_scratch`, exact names, dropped at teardown, `df`
checked first); on the old clone run today's full `thinAndPurge` SQL (named + unnamed age purges, then the thin) at a
pinned `now`; on the new clone run the batched path (age + thin per batch) to cycle completion at the same pinned
`now`; `\copy` both survivor id sets out and diff them (`EXCEPT` both ways = 0 rows; counts recorded). The scratch
SQL must be generated from / textually diffed against the Scala SQL so the script cannot drift from the code.

**D7. Measurement environment: real PG16 in local resource-limited Docker (prod-class proxy).** Local `postgres:16`
image, container/volume names namespaced `hel1435`, port bound to 127.0.0.1 only, its own cluster (the shared `helio`
dev DB is never touched; DB name `helio_hel1435_scratch` with HEL-1284's ON_ERROR_STOP name guard and a recorded
refusal test). Schema via the pinned Flyway on the assembly jar through jshell with a literal URL (HEL-1284 D1; never
`sbt run`, never anything reading `backend/.env`). Two profiles: **desktop** (`--cpus=4 --memory=4g`, for continuity
with HEL-1284) and **prod-class** (`db-g1-small`: shared-core, 1.7 GB RAM, 10 GB PD-SSD): `--cpus=0.5 --memory=1.7g`
plus block-IO limits (`--device-{read,write}-{bps,iops}`) set to the 10 GB PD-SSD published per-GB limits. Every
hardware figure is cited to its public source (URL in measurements.md); any figure that cannot be sourced is labelled
an assumption and bracketed by a sensitivity run (IO limits on/off; `--cpus` 0.5/1.0; shared_buffers 128 MB vs ~⅓ RAM).
The IO throttle must be shown to bite (a recorded `dd`/write-rate probe inside the container with and without it).
Burst credits of a shared core are not modelled; the proxy is stated as a sustained-rate approximation. If no defensible
proxy can be built (e.g. the throttle cannot be made to bite), ESCALATE rather than publish numbers.
Scale 1–10M rows: S1 (1k Outputs), S2 (10k, ~5M), S3 (1k, 7-day backlog, ~2.1M), S4 deep backlog (per-Output depth
≥ 30× steady state, e.g. 300 Outputs × ~16k rows ≈ 5M: ~55 days of 5-min points). The IO probe targets the volume's
real backing device (check major:minor through dm/LVM) with buffered and O_DIRECT writes. Host safety: all clients
`nice -n 19`, `free -g` checked before each phase and during seeding; abort if available < 12 GB. Before/after per
scenario: `EXPLAIN (ANALYZE, BUFFERS)` ×3 + plain timed ×3 for old statement and for each new batch, per-transaction
lock hold, temp (`temp read/written` + `pg_stat_database.temp_bytes` delta), rows deleted. The age purges' and payload
purge's per-pass cost is reported too. Catch-up proof on S3 AND S4: run passes with the chosen budget until complete, with `now` PINNED across the passes so
the one-shot oracle at that same `now` is the comparison; record per-pass and per-transaction max duration/rows/temp and the pass
count; final survivors equal the one-shot result. Teardown: `docker rm -f`/`docker volume rm` by exact name, recorded.

**D8. HEL-1284 evidence gaps.** Re-run HEL-1284's insert-path and V120 index-build timings on the PG16 profiles and
commit their raw logs; commit raw logs of ALL EXPLAIN runs (not only run 1) under this change's `evidence/`. State in
measurements.md that the payload "unreferenced" DELETE is an anti-join over every `node_payload_history` row and cannot
be bounded by an index (bounded instead by tier caps), with its measured cost.

**D8a. Over-age backlog measured.** S4 seeds free and beta Outputs whose dense un-thinned backlog runs well past their
caps (e.g. 40 and 100 days for some), so batches age-delete a large set; record per-batch age rows read/deleted,
duration, WAL bytes (`pg_current_wal_lsn` delta), and today's unbounded per-tier age purge as "before". The
per-batch age deletes are covered by D6(b)'s end-to-end diff (no separate age-set diff). Plan acceptance (D1) covers the batch age
DELETE too: no `Seq Scan on output_snapshot_history`, rows read ≤ the batch's rows.

**D9. Single-Output residual, quantified.** Per-Output is the floor, so one statement ranks at most one Output's rows
when that Output alone exceeds R. measurements.md states the max points per Output per day given the pipeline-run
limits (`PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` 10/60 s per user ⇒ ≤ 14,400 points/day for one Output) and the measured
per-row cost, giving the worst-case single-Output statement time/temp for a 1-day, 7-day and 30-day outage.

**D10. Reverse deadlock test kept non-vacuous.** `RetentionLockGuardSpec` REVERSE parks retention after its age
deletes, blocked on X's row lock, with the over-age P_old-linked points in the SAME Output as X. Under D4 that Output's
batch runs the age DELETE as an earlier statement of the same transaction as its thin, so the shape survives: keep
the fixture, adapt only the call/outcome types. Add a precondition asserted from a separate session before the write
is issued: P_old-linked points are row-locked (`SELECT ... FOR UPDATE NOWAIT` raises 55P03). Record two mutations:
(i) the trim takes a waiting lock instead of try-lock → the test fails (deadlock/timeout); (ii) the batch's age DELETE
is committed in its own transaction before the thin → the NOWAIT precondition fails. (ii) is the non-vacuity proof.

## Risks / Trade-offs
- [A single Output with an extreme backlog is one statement over its own rows] → floor of per-Output batching; D9
  quantifies it; not hidden.
- [Continuation keeps the DB busy every 30 s during a backlog] → each pass bounded by `maxBatches`; lock released
  between batches; budget default chosen from measured per-batch time.
- [Docker proxy ≠ Cloud SQL] → cited figures, sensitivity brackets, stated as a proxy; no "prod" claim.

## Migration Plan
No schema change; rollback is the previous jar (thin is idempotent; no persisted cursor).

## Planner Notes
- Self-approved: continuation on the next scheduler tick; three env vars; keyset over `outputs.id`; age purge folded
  per batch (also removes HEL-1284's free-tier residue as a side effect); payload purge every pass.
