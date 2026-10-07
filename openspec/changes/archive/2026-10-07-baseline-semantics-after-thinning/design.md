## Context

`OutputHistoryRepository.thinAndPurge` (HEL-1272) runs one transactional pass under advisory lock: tier age-purge
DELETEs, then a thin DELETE ranking each point by `row_number() OVER (PARTITION BY output_id, age_class,
floor(epoch / bucket_secs) ORDER BY captured_at DESC, id DESC)` and deleting `rn > 1`. Readers:
`OutputHistoryService.resolveBaseline` (`previous_run` = `listRecent(..).lift(1)`; windows = `nearestAtOrBefore`) and
`AlertEvaluationService.evaluateBaselineRule` (`listRecent(outputId, k + 1)` → `HistoryBaseline.eligible` drops the
triggering run's point → `baselineValue` over exactly `k` points, `k <= HistoryBaseline.MaxRollingN = 100`).
Interval schedules accept seconds and dataset writes auto-run on a 5 s debounce, so sub-bucket cadence is real.

## Goals / Non-Goals

**Goals:** previous / rolling_avg baselines equal the literal most recent recorded runs regardless of thin-pass timing;
code, specs and every existing doc surface agree; a thinned-fixture test proves both readers.
**Non-Goals:** new env vars, migrations, API shape changes, window-compare changes, alert UI, scale measurement.

## Decisions

**D1 — Protect by per-output recency rank; bucket-rank only unprotected rows.** Nest the thin subquery: an inner
level computes `recency = row_number() OVER (PARTITION BY output_id ORDER BY captured_at DESC, id DESC)` (same key as
`listRecent`, so "newest 101" is exactly `listRecent(_, 101)`); the outer level keeps only `recency > $protectedNewest`
rows and ranks THOSE by `(output_id, age_class, floor(epoch / bucket_secs))` as today, deleting `rn > 1`. Ranking only
unprotected rows means a bucket straddling the protection boundary still keeps its newest older point, so "exactly the
newest point per bucket among older points" holds (skeptic design-1 CR1, option b). `$protectedNewest` is a bound
parameter, never interpolated text. Alternative rejected: one-level ranking over all rows (a straddling bucket then
keeps no older point — spec/SQL mismatch); a correlated `NOT IN (... LIMIT 101)` (worse plan).

**D2 — Age purge stays first and unconditional.** The age-purge DELETEs run before the thin DELETE and are not touched,
so a protected point older than the tier cap is still purged (ruling Q1). Recency is computed over the rows remaining
after the age purge (same transaction), so protection never "reaches past" a purged point.

**D3 — One constant, derived from the alert cap.** New `com.helio.domain.history.HistoryBaselineLimits` (domain, no
I/O) holds `MaxRollingN = 100` and `ProtectedNewestPoints = MaxRollingN + 1`. `HistoryBaseline.MaxRollingN` becomes an
alias of it so the alert validator and the thinner can never drift; infrastructure must not import `services.alerts`,
which is why the constant lives in `domain`. `thinAndPurge` takes it as a default parameter
(`protectedNewest: Int = HistoryBaselineLimits.ProtectedNewestPoints`) so tests can pass a small K. Fixed, no env var.

**D4 — Readers unchanged.** With D1, `listRecent(k + 1)` and `lift(1)` already return literal recent runs; no reader
code changes. Window compare (`nearestAtOrBefore`) is untouched (ruling Q2) and only documented: after thinning the
selected point may be up to one bucket width (5 min / 1 h / 1 d by age) earlier than `latest − window`.

**D5 — Chart "Previous" option (ruling Q3).** `CHART_COMPARE_OPTIONS` becomes `METRIC_COMPARE_OPTIONS` (same list incl.
`{previous_run, "Previous"}`); the `previous_run` append branch in `compareOptions` stays for safety but is no longer
reached for charts. The overlay already labels `previous_run` as "vs previous" (`compareLabel`), so no renderer change.
Update the stale `compareLabel` comment (it cites "previous surviving point").

**D6 — Docs (ruling Q4).** Update: CLAUDE.md `GET /api/outputs/:id/history` line (replace the "previous _retained_
point" sentence); `backend/.../api/routes/alerts/README.md` (baseline semantics paragraph); helio-mcp
`COMPARE_CONFIG_DOC` and the `get_output_history` description; spec deltas below; the `HistoryThinningPolicy` and
`thinAndPurge` scaladoc. No alert-rule UI exists, so there is no UI copy to change.

**D7 — Proof test (constraints C3, C4).** New DB-backed spec (e.g. `HistoryBaselineAfterThinningSpec`), real test DB:
- Fixed `now`, aligned to a 5-min boundary plus 4 min (e.g. `2026-01-01T12:04:00Z`), never wall-clock. Output A gets
  111 points at `now - i minutes` (i = 0..110): the newest two share one 5-min bucket, so pre-change SQL deletes the
  second-newest. Point i carries a distinct value `1000 - i` in BOTH the summary `metric.value` (read by
  `OutputHistoryService.headline`) and a `columns.<metric>.sum` (read by `HistoryBaseline.summaryValue`), built the way
  the write path builds summaries.
- Point 0 is the triggering run's own point (its `run_id` = the `triggeringRunId` passed to evaluation), so
  `rolling_avg n=100` reads points 1..100 and the compare `previous_run` baseline is point 1. With `now` = 12:04, points
  100 (10:24) and 101 (10:23) share the bucket [10:20, 10:25): at K=101 point 100 is protected and point 101 is that
  bucket's surviving head; at K=100 point 100 becomes the head and point 101 is deleted. So the exact survivor set in
  (a) distinguishes 101 from 100 (under D1's unprotected-only ranking the boundary point always survives, so the
  `rolling_avg` value alone cannot).
- After `thinAndPurge(now, policy, caps)`: (a) points 0..100 all survive (ids); the older 10 keep exactly the newest
  point per bucket, including the bucket straddling the boundary; (b) compare resolution `previous_run` baseline value
  = point 1's value; (c) alert `previous` and `rolling_avg n=100` rules with a comparator/threshold that breach
  deterministically persist events whose `value.baseline` = point 1's value and = mean(points 1..100) respectively.
- Output B (free tier, default K): only 5 points, all older than 30 days ⇒ all purged (age cap beats protection).
- Output C with more than 101 points across 40 days covers the "Forty days" retention scenario at the default K.
- **Red proof:** keep the new signature, constant and specs; revert ONLY the SQL predicate (drop the `recency >
  $protectedNewest` filter so all rows are bucket-ranked) and record the failing assertions (a)-(c) from that build —
  never a compile error. Also run with K hard-set to 100 and record (a)'s exact-survivor-set assertion failing.
Plus a small-K `OutputHistoryRepositorySpec` case (boundary + straddling bucket) and updated frontend chart-option tests.

## Risks / Trade-offs

- Storage: ≤ 100 extra rows per Output, only for Outputs whose cadence is faster than the bucket width. Summary rows
  carry a ≤ 200-point series, so worst case a few MB per very fast Output — bounded, and the tier cap still applies.
- Query cost: one more window function over the same scan; HEL-1284 is told to measure the new form.
- HEL-1331 edits `helio-mcp/src/tools/outputs.ts`; whichever merges second rebases a small description diff.
- Existing `OutputHistoryRepositorySpec` thin tests seed < 101 points per Output and would stop thinning anything;
  they must pass `protectedNewest = 0` (preserving their original intent) — not be rewritten to new expectations.

## Planner Notes

- Self-approved: constant placement in `domain/history`; `protectedNewest` default param for testability; keeping the
  `compareOptions` `previous_run` append branch. Owner rulings Q1–Q4 are binding (constraints C1–C3).
- Service-level specs (`OutputHistoryRetentionServiceSpec`, scheduler hooks, `RetentionLockGuardSpec`) call
  `thinAndPurge` with the default K. If one seeds fewer than 101 points and expects deletions, either give
  `OutputHistoryRetentionService` a constructor param `protectedNewest` defaulting to the constant (wiring in `Main`
  unchanged, never env) or seed above K — whichever keeps the spec's original intent; never weaken an expectation.
