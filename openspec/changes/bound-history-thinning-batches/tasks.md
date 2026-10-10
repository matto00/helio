## Standing Constraints

- [C1] Measure only in the local `hel1435` PG16 containers/scratch DBs (never the shared `helio` dev DB, never prod/cloud); `nice -n 19`; abort if host `free -g` available < 12 GB; tear down containers/volumes/clone DBs by exact name.
- [C2] Never trust an sbt exit code alone: grep output for `TESTS FAILED` / `*** FAILED`; `-J-Xmx3g`; `sbt shutdown` every server you start.
- [C3] The REVERSE NOWAIT precondition asserts SQLSTATE 55P03 itself and rolls back/closes its session in `finally`.
- [C4] measurements.md labels insert-path/index-build logs as fresh PG16 re-runs (HEL-1284's raw logs were never committed); D9's 14,400 points/Output/day is stated as resting on the default `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` and one point per Output per run.
- [C5] An empty final batch when the last batch fetched exactly N Outputs is acceptable; do not treat it as a bug or a red test.

## 1. Backend

- [x] 1.1 Add `OUTPUT_HISTORY_THIN_BATCH_OUTPUTS` / `_BATCH_ROWS` / `OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS` to `OutputHistoryRetentionConfig` (provisional defaults, finalised in 3.x); verify the config spec covers unset/invalid/non-positive
- [x] 1.2 Per-batch age purge (one CASE-cutoff DELETE restricted to `output_id = ANY(batch)`, ELSE = strictest cap, empty map = none) before the thin in the same try-locked txn; verify existing age-purge specs pass
- [x] 1.3 Implement the batched, rank-once thin (keyset over `outputs.id`, row-budget admission with bounded index-only counts (D1), `output_id = ANY(batch)` on the DELETE target AND the ranking scan, `row_number` + `lag`, one try-locked transaction per batch, `maxBatches` budget, `startAfter`/`resumeAfter`); verify by 4.x
- [x] 1.4 Service: cursor + D4 next-due PRECEDENCE (any failure → interval > any lock-held → lockRetry > budget exhausted → next tick > complete → interval, cursor reset); wire in `Main`; verify by 4.x and existing HEL-1343 specs
- [x] 1.5 Update scaladoc on `thinAndPurge`/service to describe batches and continuation; verify `sbt compile` clean

## 2. Measurement tooling

- [x] 2.1 Perf SQL script (ON_ERROR_STOP + `helio_hel1435_scratch` name guard; refusal test recorded) for seeding and the OLD statements; the batched thin has no SQL copy: the Scala driver `HistoryThinMeasure` runs `HistoryThinBatching` itself, so the textual diff is vacuous (measurements.md section 13)
- [x] 2.2 Bring up `postgres:16` containers (desktop + prod-class profiles, names `hel1435-*`, 127.0.0.1 only), cite every hardware figure, prove the IO throttle bites (recorded probe); migrate via jshell/Flyway literal URL

## 3. Measurements (scratch only, nice -n 19, free -g ≥ 12 GB)

- [x] 3.1 S1/S2/S3/S4 (deep backlog ≥30× steady state) before vs after on both profiles: EXPLAIN (ANALYZE, BUFFERS) ×3 + plain ×3, lock hold, temp, rows; raw logs committed under `evidence/`
- [x] 3.1a Plan acceptance: no `Seq Scan on output_snapshot_history` in any batch plan on S2/S4, both profiles; S4 per-batch age deletes: rows read/deleted, duration, WAL vs today's unbounded per-tier purge; pipelines/users join scans recorded in plan dumps
- [x] 3.2 End-to-end survivor diff (D6(b)): un-age-purged S2/S3/S4 cloned twice; old full thinAndPurge vs batched to completion at pinned `now`; `\copy` ids, `EXCEPT` both ways = 0; clones dropped by exact name
- [x] 3.3 Bounded catch-up on S3 and S4 backlogs (pinned `now`): passes to completion with the chosen budget; per-pass and per-transaction max duration/rows/temp recorded; final survivors equal one-shot
- [x] 3.4 Choose defaults for batch size and budget from 3.1/3.3 against D5's criterion; update config + CLAUDE.md env table
- [x] 3.5 Re-run HEL-1284 insert-path and V120 index-build timings on PG16; commit raw logs
- [x] 3.6 Write `measurements.md` (D9 single-Output residual with numbers, age/payload per-pass cost, later-`now` note, proxy justification with sources/assumptions/sensitivity, before/after tables, one-tick prod-class result replacing the assumed 3–10×, payload "unreferenced" DELETE not index-boundable); tear down containers/volumes by exact name, recorded

## 4. Tests

- [x] 4.1 Equivalence guard: verbatim old SQL as test-only oracle vs batched thin (batch 1/2/3/large, randomized fixtures with ties and 101-boundary); passes; recorded mutation makes it fail
- [x] 4.2 Red-first (behavioural red recorded against a stub that ignores the budget/row limit): 1-batch budget thins only the first batch and reports more work; row limit splits batches; later passes drain to the oracle result
- [x] 4.3 Red-first: lock taken mid-pass keeps committed batches, leaves the rest, reports LockBusy; retry resumes
- [x] 4.4 Service specs: every D4 precedence combination (exhausted+payload failure → interval, exhausted+payload busy → lockRetry, batch busy/failed → no further batch); continuation next tick; complete → interval; existing HEL-1272/1343/1285/RetentionLockGuard/privileged specs pass
- [x] 4.5 RetentionLockGuardSpec REVERSE per D10: keep fixture, add NOWAIT precondition, record mutations (i) waiting trim lock and (ii) age DELETE in own txn both fail it; adapted repository specs run passes to cycle completion
- [x] 4.6 `sbt -J-Xmx3g testFull` green (grep output for `TESTS FAILED`/`*** FAILED`, not exit code alone); `sbt shutdown`
