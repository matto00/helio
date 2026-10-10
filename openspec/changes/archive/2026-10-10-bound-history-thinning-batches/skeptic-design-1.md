## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 22f4c1fd326b491337a91e46131fb573cc99774d (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Ground truth of today's thin.** `OutputHistoryRepository.scala:119-184`: one transaction, `pg_try_advisory_xact_lock`,
  named + unnamed-tier age purges, then the thin. The thin computes `recency` (row_number per Output) over every row,
  filters `recency > protectedNewest`, then ranks again per `(output_id, age_class, floor(epoch / bucket_secs))` and
  deletes `rn > 1`. The design's description of today is accurate.
- **D1 per-Output batching is exact.** Both windows partition by `output_id`, so restricting input to whole Outputs
  cannot change any Output's result. `V115__output_snapshot_history.sql:24` confirms `output_id TEXT NOT NULL
  REFERENCES outputs(id) ON DELETE CASCADE`, and `V94__outputs_model.sql:207` confirms `outputs.id TEXT PRIMARY KEY`.
  So keyset over `outputs.id` reaches every history row. The comparison and the ordering use the same column
  collation, so the keyset is consistent. The privileged pool is BYPASSRLS (`RetentionLockGuardSpec` asserts
  `helio_privileged ... rolbypassrls = true`), so RLS on `outputs` does not hide rows.
- **D2 "rank once" equivalence holds. I could not find a counterexample.** Within one Output ordered
  `captured_at DESC, id DESC`, all four of these hold:
  - `age_class` is non-decreasing. It is a step function of `extract(epoch FROM (now - captured_at))`, which grows
    monotonically as `captured_at` decreases, and the CASE thresholds are ordered.
  - Within one class, `bucket_secs` is constant, and `floor(epoch / bucket_secs)` is non-increasing. Numeric rounding
    of the quotient is monotone, and `floor` is monotone.
  - Ties on `captured_at` give identical keys.
  - The `(age_class, bucket)` groups are therefore contiguous. Suppose a newer row j and a row i share a group. Every
    row between them is sandwiched on both key components, so it is in the same group too.

  Consequences:
  - The head of each group among unprotected rows is the first row of the group, or the row right after the protected
    prefix.
  - "rn > 1" is equivalent to "recency > 101 AND lag(recency) > 101 AND lag(key) = key", i.e. recency > 102 and the
    same key as the previous row.
  - Config cannot break this: `fromEnv` forces recent < mid, and arbitrary bucket widths keep the property.
  - The equivalence needs the CASE and bucket expressions to stay textually identical, which D2 mandates.
- **D4 against the living spec.** I read `openspec/specs/output-history-retention/spec.md:70-110` and
  `OutputHistoryRetentionService.scala`. The CAS claim/`nextDue` mechanism can express "due next tick", and the
  modified "Second tick within the interval is a no-op" scenario stays consistent once it is scoped to a completed
  cycle. However, the precedence between conditions and the HEL-1343 requirement text are not addressed (CR 2, CR 3).
- **RetentionLockGuardSpec REVERSE** (lines 233-280) parks `thinAndPurge` in its thin DELETE after its age deletes in
  the SAME transaction. The trim victim P_old is linked only to the age-deleted points; the thin-blocked row X has
  `payload_id IS NULL`. See CR 4.
- **HEL-1284 measurements** (`archive/2026-10-09-measure-history-retention-delete-cost/measurements.md:19-25,
  165-221`):
  - At S2, the age purges cost about 150-450 ms on the desktop.
  - The payload unreferenced purge is a seq scan, about 8 ms at S2.
  - The headline risk is "a year of un-thinned backlog for 1k Outputs extrapolates to ~20 GB temp".
- **D7 proxy.** It is defensible in shape:
  - every figure is cited, and anything unsourced is labelled an assumption and bracketed;
  - a probe must show the IO throttle actually biting, and the plan escalates if it cannot;
  - it states it is a sustained-rate approximation with no burst modelling;
  - it makes no "prod" claim.

  These safeguards are adequate against invented numbers. One sharpening is a non-blocking note below.

### Verdict: REFUTE

### Change Requests

1. **Per-transaction work is not bounded for a deep backlog, and the Goals line overclaims (design.md Goals, D1, D5,
   Risks).**
   - **The claim.** Goals says "bounded per-statement and per-transaction work for the thin, independent of table
     size". A batch is N Outputs, so a batch's work is N × (rows per Output). Rows per Output grows with backlog depth,
     which is exactly what a backlog is.
   - **Why the defaults don't help.** D5 sizes N from a *steady-state* criterion ("one steady-state batch ≤ ~1 s"). On
     the desktop that is roughly 1k Outputs (HEL-1284: ~1 ms per Output at S2). For the ticket's own motivating case,
     a year of backlog at ~20 GB temp per 1k Outputs, that N gives one batch with the same ~20 GB temp as today. Even
     at N=100 it is ~2 GB per transaction on a 10 GB disk.
   - **Why the proof doesn't cover it.** The catch-up proof (D7/3.3) only uses S3, a 7-day backlog of about 2.1k rows
     per Output, roughly 4× steady state. That does not exercise the scenario the AC "without a single huge
     transaction" exists for.
   - **Required.**
     - (a) Bound each batch by row volume, not only by Output count, or prove the chosen N bounds a deep backlog. One
       example: admit Outputs into a batch until a bounded index-only count of their rows (e.g.
       `count(*) FROM (SELECT 1 ... WHERE output_id = $o LIMIT R)`) reaches a row budget R, with N as an upper cap.
     - (b) Add a deep-backlog scenario, with per-Output depth at least ~30× steady state and within the 10M-row cap. On
       it, record max per-transaction duration, rows and temp with the chosen defaults.
     - (c) State the single-Output residual explicitly with numbers. The ticket allows per-Output granularity, but its
       worst case must be quantified: max points per Output per backlog day, given the pipeline-run rate limits.
     - (d) Reword the Goals line to whatever bound is actually achieved.

2. **The precedence of next-due outcomes is unspecified (design.md D4, spec delta).**
   - **The gap.** D4 lists single outcomes (complete, exhausted, lock-held, failure), but a pass now has at least
     three parts: the age-purge transaction, the thin batches and the payload purge. Several combinations are
     undefined:
     - budget exhausted with a payload-purge failure;
     - budget exhausted with a payload LockBusy;
     - age-purge LockBusy or failure: do the thin batches still run?
     - age-purge failure with the thin completing.
   - **Why it matters.** The service's own contract (`OutputHistoryRetentionService` scaladoc: "a persistently failing
     purge retries once per interval rather than every tick") and HEL-1343 ("When any part of a pass raised an error,
     the next pass SHALL wait the full purge interval") imply that failure must override "continue next tick".
     Otherwise a persistently failing payload purge during a backlog drain retries every 30 s.
   - **Required.** Write an explicit precedence rule into D4 and the spec delta. For example: any failure → full
     interval (cursor kept); else any lock-held → lockRetry; else budget exhausted → next tick; else → interval. Also
     state what happens to the thin when the age-purge transaction is lock-held or fails. Add matching scenarios.

3. **The HEL-1343 requirement is not updated in the delta (missing contract update).**
   - **The gap.** The living requirement "Lock-held retention skip retries within a short window" (spec.md:70-77) still
     says "A retention pass has two parts, the history thin/purge and the node-payload purge". It also says "Points ...
     eligible for thinning ... SHALL remain untouched by a lock-held skip". Under the design the history part becomes
     an age-purge transaction plus many batch transactions, and batches committed before a mid-pass skip stay
     committed. The ADDED requirement says this, but the unmodified HEL-1343 text now reads as contradicting it.
   - **Required.** Add a MODIFIED block for that requirement that redefines the parts and scopes "untouched" to the
     Outputs not yet thinned. Fold CR 2's precedence into it.

4. **The REVERSE lock-guard scenario becomes vacuous, and the design only asks that it "pass" (tasks 4.4,
   RetentionLockGuardSpec:233-280, spec.md:99-103).**
   - **What the scenario guards.** A run's trim must not deadlock against retention that has already deleted points
     linked to the trim's payload in its open transaction.
   - **Why it goes vacuous.** After D3, the age deletes commit in their own transaction before any thin batch starts.
     The parked thin-batch transaction then holds only X's row, and X has no payload. So the test would still go green
     while exercising no row-lock conflict at all, and the deadlock guard it certifies would no longer be proven.
   - **Required.**
     - Re-point the scenario and test so the retention transaction that is parked has itself already deleted points
       linked to the trim victim, i.e. a thin batch that deleted payload-linked points before blocking. Prove it is
       failable, e.g. by a recorded mutation that removes the shared try-lock in the trim, or removes the batch's
       try-lock.
     - MODIFY the spec scenario text ("has already age-deleted points") to match the new transaction structure.

5. **The D6(b) survivor capture cannot work as written (design.md D6(b), tasks 3.2).**
   - **The problem.** "survivor ids after the old statement (inside a rolled-back txn, copied to an unlogged table)":
     anything written to a table inside a transaction that is then rolled back is rolled back too.
   - **Required.** Specify a capture that survives the rollback. Examples:
     - `\copy (SELECT id FROM output_snapshot_history) TO '<file>'` inside the transaction, then ROLLBACK, then load the
       file;
     - or clone the seeded database (`CREATE DATABASE ... TEMPLATE`, by exact namespaced name, dropped at teardown) and
       run old on one clone and batched on the other.

     Whichever is used must keep the textual-identity check against the Scala SQL.

### Non-blocking notes

- Age purges every pass: D4 runs the age purges (and the payload purge) on every continuation pass, i.e. every
  scheduler tick (about 30 s) during a drain. HEL-1284 puts the S2 age purges at about 150-450 ms on the desktop, so
  on the prod-class proxy this repeated cost should be measured and reported. Alternatively, run them only on a cycle's
  first pass, which is equally semantics-preserving.
- In the modified "Second tick within the interval is a no-op" scenario, "a pass that thinned every Output" is
  ambiguous once a cycle spans passes. "A pass that completed the thin cycle" is clearer.
- D7 throttle probe: probe both buffered and `O_DIRECT` writes on the volume's actual backing device. `--device-*-bps`
  bound to the wrong major:minor (dm-crypt/LVM) silently does nothing; the planned probe catches this only if it
  targets the volume path.
- Task 4.2 "red on old code": a missing parameter is a compile error, not a behavioural red. Record the red as the new
  test against a stub that ignores the budget (thins everything), so the red is behavioural.
- Continuation passes use a later `now` for later Outputs. That is per-Output identical to a one-shot run at that later
  time, so it is not a semantic change, but measurements.md / the spec should say so explicitly so the "same reference
  time" wording is not misread.
