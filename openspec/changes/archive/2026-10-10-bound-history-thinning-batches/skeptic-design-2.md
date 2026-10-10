## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 22f4c1fd326b491337a91e46131fb573cc99774d. The planning artifacts are untracked in the change dir.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/bounded-history-thinning-batches/HEL-1435`.

### What I verified (with evidence)

**Round-1 change requests, checked against the artifacts:**

- **CR1 (row-bounded batches): mostly resolved.**
  - D1 now admits Outputs under a row budget R, using index-bounded `LIMIT remaining+1` counts. The first candidate is
    always admitted, and N stays as a cap.
  - The admission count is bounded on PG16. `V115__output_snapshot_history.sql:35` creates
    `idx_output_snapshot_history_output_captured (output_id, captured_at DESC)`, so
    `SELECT 1 ... WHERE output_id=$o LIMIT k` reads at most k index entries (plus heap visits if the visibility map
    is stale, still at most k). Per batch, admission reads at most R plus one entry per candidate.
  - The Goals line has been reworded to the bound actually achieved. S4 (deep backlog, at least 30x steady state)
    has been added to D7, 3.1 and 3.3, and the D9 single-Output residual is quantified (14,400 points/day from the
    10-per-60-s run limit).
  - What is still open is the bound on the DELETE statement itself, not the ranked input; see new CR 1.
- **CR2 (precedence): resolved.**
  - D4 states failure > lock-held > budget-exhausted > complete. That order is evaluated over all three parts, and
    each outcome has a defined cursor handling.
  - The spec delta's ADDED requirement states the same order word for word. The MODIFIED "Tiered" text lists both
    exceptions, and the ADDED requirement resolves how they combine, so the two are consistent.
  - "An age purge that is lock-held or failed runs no thin batch" is stated in both D3 and the spec.
  - Matching scenarios exist ("A failure during a drain…", "A lock-held part during a drain…"), and task 4.4
    enumerates the combinations.
- **CR3 (HEL-1343 requirement): resolved.** A MODIFIED block redefines the pass as three parts. It scopes
  "untouched" to the skipped part and says committed batches stay. It keeps the failure-overrides-lock rule. The
  header text matches the living `spec.md:70` exactly.
- **CR4 (REVERSE vacuity): resolved in substance.**
  - D10 re-points the parked transaction to a thin batch that has already deleted the points linked to P_old.
  - It adds a `FOR UPDATE NOWAIT` → 55P03 precondition from a separate session.
  - I checked the mechanism against ground truth. `V116:62` declares `payload_id ... REFERENCES
    node_payload_history(id) ON DELETE SET NULL`, so a trim that skipped the try-lock would need row locks on
    exactly the rows the parked batch has deleted. The precondition is the real non-vacuity guard. See note N2 on
    the mutations.
  - The spec scenario wording has been updated.
- **CR5 (D6(b) capture): resolved.** The OLD victim set is materialised as committed tables by running the old
  DELETE's exact `IN (...)` subquery as a SELECT. It is computed after the age purges commit, and the two-clone
  alternative is allowed. The textual-identity check against the Scala SQL is retained.

**New questions the orchestrator asked:**

- **Is row-budget admission bounded on PG16?** Yes for admission, per above. The DELETE's own target scan is not
  bounded; see CR 1.
- **Is next-due precedence consistent between D4 and the spec delta?** Yes, per the CR2 check above.
- **Does running the age purge only at cycle start preserve semantics?** Mostly yes. Today the age purge and the
  thin share one transaction (`OutputHistoryRepository.scala:178-183`). Under the new design, rows that cross a tier
  cap between cycle start and a later pass's `now` are not age-purged until the next cycle. I reasoned through
  whether that changes any survivor that is not over-age:
  - Over-age rows are always the oldest rows of their Output.
  - So they never change the `recency` of newer rows, and never change which newer row heads an
    `(age_class, bucket)` group.
  - Survivors among rows that are not over-age are therefore identical. Over-age rows are only removed later, so
    the age-cap latency grows by the length of the drain.

  That latency is not stated anywhere (note N1). Separately, the age purge itself is one transaction, unchanged, and
  under a deep backlog that is exactly the "single huge transaction" the AC forbids. It is not exercised by the
  planned scenarios; see CR 2.
- **Is D10's test non-vacuous?** Yes, but only through the NOWAIT precondition, not through the listed mutations
  (note N2).

**Ground truth for the new findings:**

- `OutputHistoryRepository.scala:151-176`: the thin is `DELETE FROM output_snapshot_history WHERE id IN (<ranked
  subquery>)`, and the target has no other predicate.
- HEL-1284's recorded plan
  (`archive/2026-10-09-measure-history-retention-delete-cost/evidence/S2-after-v120-pg16-proxy.txt:131-136`) is
  `Delete → Hash Semi Join (Hash Cond: id = ranked.id) → Seq Scan on output_snapshot_history (rows=4986230)`. Half
  of today's "two seq scans" (measurements.md:22) is this target scan, which is separate from the ranking input.
- `OutputHistoryRepository.scala:125-142`: each age purge is one `DELETE ... USING pipelines, users WHERE tier = ...
  AND captured_at < cutoff`. Its size is proportional to the over-age rows, with no limit.

### Verdict: REFUTE

### Change Requests

1. **The batch DELETE's target scan is not bounded, so "independent of table size" can still fail (design.md Goals,
   D1, D7; tasks 1.3, 3.1).**
   - **The plan risk.** Today's plan seq-scans the entire table as the semi-join target, and the planner picks that
     shape (Hash Semi Join) whenever the estimated subquery output is large relative to PK probes. That is
     plausible for a batch of R rows, especially in the default range D5 targets. The design restricts only the
     ranking input ("one DELETE restricted to `output_id = ANY($batch)`"), and does not say where.
   - **The cost if it happens.** If the batch is still written `DELETE ... WHERE id IN (...)`, each batch can still
     read the whole table. At M batches per pass, that is M full scans per pass: worse aggregate IO than today,
     even with no temp spill.
   - **Required:**
     - (a) Specify in D1 that `output_id = ANY($batch)` appears both in the innermost ranking scan and on the DELETE
       target itself, e.g. `DELETE FROM output_snapshot_history WHERE output_id = ANY($batch) AND id IN (...)`.
       Rows outside the batch are never victims, so this does not change semantics. It lets the
       `(output_id, captured_at)` index bound the target.
     - (b) Add an explicit plan acceptance check to D7/3.1. On S2 and S4, on both profiles, no batch statement's
       EXPLAIN may contain a `Seq Scan on output_snapshot_history`, and rows read (index plus heap) per batch must
       be at most about R plus the batch's own rows. Record it per scenario.
     - (c) If PG16 still chooses a full scan, record that and fix it before choosing defaults, rather than
       publishing a "bounded" claim from timings alone.

2. **The age purge is an unbounded single transaction under a backlog, and no planned scenario exercises it
   (design.md D3/D4/D7, tasks 3.1/3.3; AC "without a single huge transaction").**
   - **The gap.** The design keeps the age purges as one transaction with unchanged SQL. After a long retention
     outage, the rows crossing a tier cap during the outage are dense and un-thinned. On the free tier, for
     example, the cap is 30 days, so anything past 30 days has crossed. One age-purge transaction then deletes all
     of them. Its size is proportional to backlog depth, which is exactly the shape the ticket's catch-up AC rules
     out.
   - **Why the scenarios hide it.** S4's tier mix is unspecified. If S4 is all owner-tier (365-day cap), its
     "per-transaction max" never sees this transaction.
   - **Required:**
     - (a) Make S4, or an S5, include free- and beta-tier Outputs whose backlog extends well past their caps, e.g.
       55 days at 5-minute cadence against a 30-day cap.
     - (b) Record the age-purge transaction's rows, duration, WAL and lock hold as part of the per-transaction
       maximum in 3.3.
     - (c) Then do one of two things:
       - bound it. A set deletion split into short `LIMIT`-batched transactions, e.g. `DELETE ... WHERE id IN
         (SELECT id ... AND captured_at < cutoff LIMIT k)` repeated, is semantically identical because the final
         deleted set is the same. It would also need the continuation and precedence rules extended to cover it.
       - or state in Goals and measurements.md that it is an unbounded residual, with the measured numbers and an
         explicit argument for why that is acceptable under the AC. A residual of that kind should probably also be
         raised for owner ruling rather than self-approved.

### Non-blocking notes

- **N1. Age-cap latency during a drain.** Age purges run only at cycle start, so during a multi-pass drain a point
  crossing its tier cap survives until the next cycle starts. That is up to the drain length plus one interval,
  versus at most one interval today. Survivors among rows that are not over-age are unaffected (reasoning above).
  State the bound with S3/S4's measured pass counts in measurements.md and the spec, so "at most once per interval"
  is not read as a latency guarantee.
- **N2. D10 mutations do not discriminate vacuity.** Both listed mutations would fail even the vacuous fixture,
  where P_old-linked points are age-deleted and committed first:
  - "trim takes a waiting lock" blocks on the advisory key regardless of row locks;
  - "thin batch without the advisory lock" lets the trim delete P_old, which breaks the final
    `payloadIds == Set(pOld, new)` assertion.

  The NOWAIT precondition is the actual non-vacuity guard. Also record that the old fixture, with P_old-linked
  points over-age, trips that precondition. In addition, the DELETE's row-processing order is plan-dependent
  ("inserted before X so the scan reaches them first"). If CR 1(a) changes the plan to an index scan on
  `(output_id, captured_at DESC)`, the order becomes newest-first. P_old-linked points must then be newer than X,
  or the precondition fails. Choose capture times accordingly.
- **N3. D6(a) mutation.** "`lag` comparing only `bucket`" is close to an equivalent mutant. `floor(epoch/300)` and
  `floor(epoch/3600)` of present-day epochs differ by more than 10x, so adjacent rows in different classes never
  share a bucket value, and the guard would likely stay green. Use killable mutations instead: protected count 100,
  `>=` instead of `>`, or dropping the `lag(recency) > 101` term.
- **N4. Fixed `now` in the multi-pass catch-up (3.3).** "Final survivors equal one-shot" holds only if the scratch
  passes use one pinned `now`, or the oracle is evaluated per Output at the `now` of the pass that thinned it. The
  spec wording already says this; make 3.3 say which approach is used.
- **N5. Unspecified edges.**
  - Does the payload purge run when the age purge or a thin batch was lock-held or failed? Today it always runs, so
    keep that and say so.
  - If the final batch of a pass consumes the last Output, the pass should return `resumeAfter = None`, not an extra
    empty pass.
  - The REVERSE scenario no longer covers the separate age-purge transaction parking on a row lock. It is guarded by
    the same try-lock, so this is acceptable, but the spec scenario title still says "thin and age deletes".
