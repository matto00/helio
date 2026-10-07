## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d125b654141ac79d96a8fd0f9cb5e74b834c7c0c (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Owner ruling exists.** `.concertino/runs/HEL-1285/events.jsonl` line 5: `escalation.answered`, answer_source human,
  `["protect-newest-101","keep-d6-and-document","re-add-here","docs-only"]`. The design implements all four. I did not
  re-litigate them.
- **Thin SQL claim.** `OutputHistoryRepository.scala:133-150`: one `row_number() OVER (PARTITION BY output_id,
  age_class, floor(epoch / bucket_secs) ORDER BY captured_at DESC, id DESC)`, delete `rn > 1`. The age purge runs first in
  the same transaction (`:155`), so D2's claim that recency is ranked after the age purge holds.
- **Reader claims.** `listRecent` orders by `(capturedAt.desc, id.desc)` (`:80-83`), the same key D1 uses. Compare
  `previous_run` = `recent.lift(1)` (`OutputHistoryService.scala:118-119`). Alerts use `listRecent(k + 1)` and then
  `eligible`, which filters by run id (`AlertEvaluationService.scala:145-146`). `MaxRollingN = 100`
  (`HistoryBaseline.scala`). So protecting the newest 101 does cover the triggering point plus 100 eligible ones, whether
  or not the triggering point is committed yet. A thin pass that races a new insert protects a superset. D4 (no reader
  change) is sound.
- **Chart "Previous" (Q3).** `compareOptions.ts` filters out `previous_run` only because of HEL-1350 D3. Per
  `archive/2026-10-06-chart-output-compare-picker/design.md:37-41`, the stated reason is "the driver forbids adding
  'previous run' copy while HEL-1285 is open", not a renderer limitation. `chartOverlay.ts:117` already labels via
  `compareLabel`. D5 is sound.
- **Doc surfaces (Q4).** No alert UI exists. The stale wording sits in CLAUDE.md:140 ("previous _retained_ point"),
  `helio-mcp/src/tools/outputs.ts:60-61,245-246`, `metricHistoryView.ts:79-80`, and the main spec
  `output-history-api/spec.md:55-56`. All of these are in D6 or the deltas. The alerts README has no baseline text
  today, so D6 adds it.
- **Spec deltas.** All MODIFIED requirements keep every scenario of the main requirement they replace (I checked
  scenario lists for output-history-api, output-history-retention and chart-history-overlay).
- **Existing tests affected.** `RetentionLockGuardSpec:225,276` asserts `Purged(2)`/`Purged(3)` from direct
  `thinAndPurge` calls on fewer than 101 points. `OutputHistoryRetentionServiceSpec` goes through the service, and
  `PipelineSchedulerServiceMaintenanceHooksSpec` overrides `thinAndPurge` with the old 3-arg signature (`:47`). Tasks
  4.1/4.5 and the Planner Notes cover these through `protectedNewest`. That is acceptable, but see CR2 for the
  compile-time consequence.

### Verdict: REFUTE

### Change Requests

1. **Spec and SQL disagree for the bucket that straddles the protection boundary.** Under D1, `rn` is ranked over all
   of an Output's points, protected ones included. In a bucket holding both protected and older points, the protected
   points take `rn = 1..m`, so every unprotected point in that bucket is deleted and that bucket keeps zero older
   points. The retention delta's "Forty days" scenario says each Output keeps "exactly the newest point per bucket among
   its older points", which needs one older survivor in that bucket. Either:
   (a) keep D1 and reword the requirement and scenario, e.g. "at most one point per bucket among older points; a bucket
       that also holds protected points keeps no older point"; or
   (b) rank `rn` over unprotected rows only (nested subquery: recency first, then the bucket rank over
       `recency > K`), so the spec text holds.
   State the choice in D1. Make test 4.2/4.3 (a) assert the straddling-bucket outcome explicitly, not just "thinned per
   bucket".

2. **Task 4.4's red-proof procedure can't produce assertion failures as written.** Task 4.1 edits
   `OutputHistoryRepositorySpec` to pass `protectedNewest = 0`, and 4.5 may do the same in `RetentionLockGuardSpec` and
   the hooks spec's override. If you stash "only the repository change", the parameter disappears, test compilation
   fails, and the "red run" is a compile error, not the failing assertions C3 requires. Specify the revert precisely:
   keep the new signature and constant, and revert only the SQL predicate (drop `AND recency > $protectedNewest` /
   the recency window). Then record the red output of the new spec's assertions (newest-101, compare `previous_run`,
   alert `previous`, alert `rolling_avg`) from that build.

3. **The D7 fixture can pass vacuously on the compare/previous assertions. Make it deterministic and discriminating.**
   As written ("110 points 1 minute apart within the last 2 h"), these gaps remain:
   - **Bucket alignment.** Buckets are epoch-aligned (`floor(epoch / 300)`). If the newest point falls in the first
     minute of its 5-min bucket (about a 1-in-5 chance with a wall-clock `now`), the second-newest is the newest of the
     previous bucket and survives the pre-change SQL. The compare `previous_run` and alert `previous` assertions would
     then pass against the old code. Require a fixed, bucket-aligned `now` and `captured_at` values that put the newest
     two points in the same 5-min bucket.
   - **Distinct values.** Every point must carry a distinct metric value (e.g. its index) in a summary shape that
     `HistoryBaseline.summaryValue` and `OutputHistoryService.headline` actually read. Equal values make
     "literal previous" and "older survivor" indistinguishable.
   - **The +1 must be exercised.** Seed the triggering run's own history point as the newest point (same `run_id` as
     the `triggeringRunId` passed to `evaluateForOutput`). That way `rolling_avg n=100` needs points 2..101, and a
     K=100 implementation would fail. Without it, the test can't tell 100 from 101, which is the reason for C1's
     number.
   - **Event must persist.** Choose comparator/threshold so the baseline rule breaches deterministically. Otherwise no
     event is written and `value.baseline` can't be read.
   - **Item (d) is mis-specified.** The "> 7 d old" points of the 110-point Output are never among its newest 101, so
     they don't prove "a protected point older than a tier cap is still purged". Use a separate free-tier Output whose
     only points are all older than 30 days, with the default K, matching the retention delta's "Age cap overrides
     protection" scenario.

### Non-blocking notes

- The retention delta's "Forty days" scenario now says "more than 101 points". If
  `OutputHistoryRetentionServiceSpec` is kept with fewer than 101 points and `protectedNewest = 0`, it no longer tests
  the scenario as written. Either seed above 101 or name the test that does cover it.
- `PipelineSchedulerServiceMaintenanceHooksSpec:47` overrides `thinAndPurge`. Adding a defaulted fourth parameter
  changes the override signature, so the executor must update the override (a compile fix, not an expectation change).
- HEL-1284 (scale measurement) should be told the thin DELETE gains a second window function. The Risks section says
  this already; make sure it actually lands as a comment on HEL-1284.
