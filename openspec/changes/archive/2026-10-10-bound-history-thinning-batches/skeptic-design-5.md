## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD 22f4c1fd326b491337a91e46131fb573cc99774d. The planning artifacts are untracked in the change dir.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/bounded-history-thinning-batches/HEL-1435`.
This was a read-only review: no database, no sbt, no `.env`.

### What I verified (with evidence)

**Round-4 CR1 (D10 stale and its proof impossible): resolved.**
- **The fixture premise holds.** D10 now says the REVERSE fixture is kept, because the age DELETE and the thin of the
  same Output run in one batch transaction. I checked this against `RetentionLockGuardSpec.scala:235-280`:
  - both P_old-linked over-age points and X/Y are inserted on the same `oid`;
  - retention is parked on X's row lock, which is held by `holder`.
  - Under D4 the batch's age DELETE row-locks the P_old points, and that same transaction then parks on X. The test
    stays non-vacuous.
- **The stale rationale is gone.** The "commit first, so vacuous" text no longer appears. A grep for
  `commit(ted)? first|vacuous|old shape|thin-linked` finds only the D10 heading.
- **The non-vacuity proof is now producible.**
  - The new precondition is `FOR UPDATE NOWAIT` from a separate session, which must raise 55P03.
  - Mutation (ii) commits the age DELETE in its own transaction before the thin. The P_old rows are then committed as
    deleted, so the NOWAIT select returns zero rows and raises nothing. The precondition fails, as D10 claims.
  - Mutation (i), a waiting trim lock, makes the write block behind retention, which is itself blocked on `holder`.
    `holder` is released only in `finally`, so `writeCompleted` goes false and the test fails.
- **Task 4.5 matches D10.** The living spec scenario at `spec.md:99-103` ("has already age-deleted points") is valid
  again. The delta's reworded "age or thin deletes" scenario is consistent with it.

**Round-4 CR2 (scale equivalence assumed a separate age phase): resolved.**
- D6(b) now runs end to end on S2, S3 and S4 seeds that have not been age-purged:
  - two `TEMPLATE` clones with exact names, with `df` checked first;
  - today's full `thinAndPurge` SQL (named and unnamed age purges, then the thin) on one clone;
  - the batched path run to cycle completion on the other, at the same pinned `now`;
  - `\copy` of the survivor ids, compared with `EXCEPT` both ways;
  - the scratch SQL textually diffed against the Scala SQL.
- D8a now defers the age-set check to this end-to-end diff and keeps the measurements: per-batch age rows, WAL, and
  the plan acceptance. Tasks 3.1a and 3.2 match.
- No remnants of a pre-aged seed or an age-phase capture are left (grep for
  `pre-aged|age-deleted set|materiali|age phase|chunk|RETURNING`: only the "(no separate age phase)" disclaimer).

**Round-4 non-blocking notes:**
- N1 (the invariant was over-strong): the invariant text is removed. D4 now grounds equivalence on the age
  predicate being per-row and the thin being per-Output.
- N2: the ADDED requirement now says "for that batch's Outputs".
- N3: task 4.5 now says "adapted repository specs run passes to cycle completion".
- N4: task 3.1a records the pipelines/users join scans in the plan dumps.

**Earlier rounds' CRs are still resolved in the current text:**
- R1 CR1: row budget R, S4 deep backlog, D9 residual, and the Goals wording.
- R1 CR2 and CR3: the D4 precedence (1)-(4), the ADDED precedence paragraph, the drain failure and lock scenarios,
  and the MODIFIED HEL-1343 requirement.
- R1 CR5: clones.
- R2 CR1: `output_id = ANY($batch)` on both the target and the ranking scan, plus the no-Seq-Scan acceptance.
- R2 CR2 and R3 CR1: the age purge is folded per batch and bounded by the `(output_id, captured_at DESC)` index.

**Ground truth re-derived independently:**
- **Today's SQL.** `OutputHistoryRepository.scala:119-184` matches the design's description:
  - named and unnamed age purges;
  - a `recency` window, then a second window partitioned by `(output_id, age_class, floor(epoch/bucket_secs))` over
    the unprotected rows only;
  - one try-locked transaction.
- **D2 rank-once equivalence.**
  - `age_class` is monotone in `captured_at` within an Output, and the bucket is monotone within a class. Ties share
    the class and the bucket. So each group is contiguous in `captured_at DESC, id DESC` order.
  - An unprotected row is a non-head of its group exactly when its immediate predecessor in that order is unprotected
    and in the same group.
  - The D2 rewrite is exact. D6(a) is the guard for this, and its mutations (protected count 100, `recency >= 101`)
    are non-equivalent, so it can fail.
- **Service.** `OutputHistoryRetentionService.scala` claims the slot by CAS before running and recovers both parts.
  D4's precedence extends the existing failed/busy logic consistently, and continuation is just a different `nextDue`
  value.
- **Config.** `OutputHistoryRetentionConfig.fromEnv` has the `positive(...)` helper that D5 reuses.
- **Spec delta vs living spec.** I diffed the token streams. Every original scenario in both MODIFIED requirements
  is carried over. The only edits are the intended ones (the continuation clause, the redefined parts, the scope of
  "already committed batches"), and nothing is dropped.

### Verdict: CONFIRM

The design is sound enough to implement. Every prior change request is resolved in the artifacts themselves, and I
found no new contradiction, placeholder or stale reference.

### Non-blocking notes

- **Empty trailing pass.** When the last batch of a cycle fetches exactly N candidates, it returns `Some(cursor)`, so
  the next tick runs one empty batch before the cycle completes. This is harmless. D1's "no extra empty pass" holds
  only for the fewer-than-N case, so the executor should not treat this as a bug, or a test as a red.
- **The NOWAIT precondition must assert the error itself.** It must assert that 55P03 is raised, not that "no
  exception" occurs or that rows come back. It must also roll back or close its session in `finally`. Otherwise
  mutation (ii) cannot fail it.
- **AC4 provenance.** HEL-1284's original insert-path and index-build raw logs were never committed. Its
  `measurements.md:159` keeps only run 1's plan text. D8 re-runs those timings on PG16 instead. `measurements.md`
  should say plainly that the committed logs are re-runs and not HEL-1284's originals.
- **D9 inputs.** The per-Output daily ceiling of 14,400 points assumes the default
  `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` (`PipelineRunGuardConfig.scala:32`) and one history point per Output per run.
  State both as assumptions.
- **Wording.** D8a's sentence "The age-deleted per-batch age deletes are covered by..." is garbled, but its meaning
  is clear from D6(b).
