## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD d125b654141ac79d96a8fd0f9cb5e74b834c7c0c. The planning artifacts are untracked in the change dir.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/baseline-semantics-after-thinning/HEL-1285`.

### What I verified (with evidence)

- **Owner ruling.** `.concertino/runs/HEL-1285/events.jsonl` line 5 is an `escalation.answered` event with
  answer_source human and the answers `[protect-newest-101, keep-d6-and-document, re-add-here, docs-only]`. Q1 maps to
  D1–D3, Q2 to D4, Q3 to D5 and Q4 to D6. I did not re-litigate the rulings.
- **CR1 (straddling bucket) is resolved.** D1 now uses a nested query. The inner level computes per-output `recency`;
  the outer level filters `recency > $protectedNewest` and only then bucket-ranks. A window function runs after the
  WHERE of its own SELECT level, so the nesting is required, and the design specifies it. The retention delta now says
  "each bucket keeping its newest unprotected point" and adds the scenario "including a bucket that also holds
  protected points". The SQL and the spec agree.
- **CR2 (red proof) is resolved.** The red proof now keeps the signature, constant and specs, and drops only the
  `recency > K` filter. With the filter gone, the outer rank covers all rows, which is the pre-change semantics. That
  build still compiles: `build.sbt` has no `-Werror`/`-Wunused` scalacOptions, so an unused `protectedNewest` cannot
  fail the build.
- **CR3 (fixture) is resolved. I checked the arithmetic myself.** `now` = 12:04, and point i is at `now − i min`.
  - Points 0 and 1 share [12:00, 12:05), so the pre-change SQL deletes point 1. The compare baseline would then be
    point 5 (11:59, head of [11:55, 12:00)), so (b) goes red.
  - The alert `previous` baseline would also be point 5, so (c-previous) goes red.
  - `rolling_avg n=100` would see about 22 eligible points, so `baselineValue` returns None and no event is written.
    (c-rolling) goes red.
  - At K=101 the survivors among points 101..110 are 101, 105 and 110. At K=100 they are 100, 105 and 110. Point 101
    falls in [10:20, 10:25) with point 100. So the exact-survivor-set check does distinguish 101 from 100. The design
    is right to say the `rolling_avg` value alone cannot: points 1..100 survive in both cases.
  - Point 0 carries the triggering `run_id`, so `eligible` (`HistoryBaseline.scala`, `filterNot(_.runId.contains)`)
    drops it and `listRecent(k+1)` exercises the +1.
  - Output B (free tier, every point older than 30 days) correctly tests the age cap overriding protection.
- **Fixture feasibility.**
  - `thinAndPurge` takes `now` as a parameter (`OutputHistoryRepository.scala:117`). Both age-class and cutoff
    calculations use `$nowTs`, never SQL `now()`, so a fixed 2026-01-01 `now` is safe.
  - The existing repository spec uses a per-class `EmbeddedPostgres` (`OutputHistoryRepositorySpec.scala:31-40`), so a
    global thin pass in a new spec cannot touch other worktrees' data.
  - V115 `run_id` and V61 `alert_events.pipeline_run_id` have no FK, so synthetic run ids work.
  - `headline` reads `summary.metric.value`, gated on `v == 1` (`OutputHistoryService.scala`). `summaryValue` reads
    `columns.<metric>.sum`. D7 names both.
- **D3 placement.** `com.helio.domain.history` exists (it holds OutputCompare, OutputSummaryReducer and others).
  Infrastructure already imports `com.helio.domain.*` (`UserTier`), and no `HistoryBaselineLimits` exists yet.
- **D4 (readers unchanged).** Compare `previous_run` is `recent.lift(1)`. Alerts use `listRecent(k + 1)` then
  `eligible`. Both use the `(captured_at DESC, id DESC)` order that D1's recency uses.
- **D5.** `compareOptions.ts:17-19` filters out `previous_run` only for HEL-1350 D3. The archived design
  (`2026-10-06-chart-output-compare-picker/design.md:37`) confirms this was a copy embargo, not a renderer limitation.
- **D6 doc surfaces exist** and carry the stale wording:
  - CLAUDE.md:140
  - `helio-mcp/src/tools/outputs.ts:56-60,238-246`
  - `metricHistoryView.ts:79-80`
  - `api/routes/alerts/README.md` (exists)
  - main `output-history-api/spec.md:55-56`

  `output-history-scrubber`'s "next-older retained point" is about arbitrary points, not the newest. It is correctly
  left alone.
- **Spec deltas.** I diffed each MODIFIED requirement against its main spec:
  - chart-history-overlay, output-history-api and output-history-retention keep every original scenario; only the
    text and the added scenarios change.
  - The alert ADDED requirement agrees with the main spec's lines 180-207 ("n newest older points").
- **Ticket AC coverage.**
  - AC1 (decide and record): the ruling above, recorded on HEL-918 per workflow-state.
  - AC2 (code plus one test asserting both readers): tasks 1.2 and 4.3.
  - AC3 (docs): tasks 3.1-3.3 and 2.2. No alert UI exists, per Q4.

### Verdict: CONFIRM

### Non-blocking notes

- `OutputHistoryRetentionServiceSpec.scala:177` also overrides `thinAndPurge` with the 3-arg signature, not only
  `PipelineSchedulerServiceMaintenanceHooksSpec.scala:47`, which is the one task 1.2 names. Both need the compile fix.
  The same spec asserts `historyCount(oF) shouldBe 1923` (`:85`), so it will need the Planner-Notes
  `protectedNewest`-constructor route, not "seed above K".
- With unprotected-only ranking, the newest unprotected point always heads its bucket, so K=101 in practice keeps at
  least 102 points. The spec's "SHALL NOT delete newest 101" still holds. Docs should say "never deletes the newest
  101", not "keeps exactly 101".
- D7's Output C is a single Output. The retention "Forty days" scenario names a free-tier and an owner-tier Output.
  Seed one of each, or note which half Output C covers.
- The fixture summaries must carry `v: 1` as well as `metric.value`, or `headline` returns None and (b) fails for the
  wrong reason. "Built the way the write path builds summaries" implies this; state it in the spec.
- Tell HEL-1284 about the extra window function (already in Risks), as round 1 noted.
