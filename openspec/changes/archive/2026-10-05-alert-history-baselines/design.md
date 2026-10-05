## Context

See proposal.md. Current state (verified on main 2f495650):
- `AlertEvaluationService.evaluateForOutput(outputId, rows, triggeringRunId)` is called from
  `PipelineRunService.onUnblockedRunSuccess` (~:1512-1540) once per Output, with that node's in-memory rows
  (`Seq[Map[String, Any]]`) and `Some(runId.value)`.
- `alertEvaluation` is a strict `val` Future, so it starts concurrently with `materializedWrites`, which inserts
  this run's `output_snapshot_history` point (`run_id = Some(runId.value)`, via `overwriteRowsWith`). Whether the
  current run's point is visible when evaluation reads history is a race.
- `extractMetric` (:60-67) never coerces strings and sums typed numbers per row; `OutputSummaryReducer.summarize`
  stores `rowCount` and `columns[c] = {count,sum,min,max}` using `JsSemantics.coerceNumber` (coerces numeric
  strings), only for columns whose every non-blank cell coerces, capped at 20 columns (sorted by name).
- `OutputHistoryRepository.listRecent(outputId, limit)` returns newest first (privileged pool).
- `ApiRoutes.outputHistoryRepoOpt` (:253) is declared before `alertEvaluationServiceOpt` (:415).

## Goals / Non-Goals

**Goals:** baseline rules whose current and baseline values are computed identically; a deterministic exclusion of
the triggering run; strict 400 validation; no behaviour change for existing threshold rules.

**Non-Goals:** changing `extractMetric`; time-window (`1d`/`7d`) alert baselines; headline-metric (`summary.metric`)
baselines; any edit to `PipelineRunService`, `Main`, the reducer, or the history repository.

## Decisions

**D1 — One reducer for both sides (no extractMetric change).** For a baseline rule, the current value is computed by
converting the node rows to `JsObject`s exactly as the history write path does (`PipelineRowJson.anyToJsValue`,
PipelineRunService ~:1424) and running `OutputSummaryReducer.summarize(jsRows, OutputKind.Table, JsObject.empty)`;
the value is then read from that summary by the same pure accessor used for every stored point:
`"*"` → `rowCount`, otherwise `columns[metric].sum`. Kind `Table` makes `metric`/`series` null; column stats are
kind-independent, so the current summary's `columns` is byte-identical to what the write path stores for these rows.
Alternatives: (a) compare against the current run's own stored summary — rejected: racy (the point may not be
committed yet) and couples evaluation to write ordering; (b) align `extractMetric` with the reducer — rejected:
changes existing threshold rules' outcomes (numeric strings start evaluating, mixed columns change), a product
call outside this leaf; (c) use `summary.metric.value` — rejected: only exists for Metric-kind Outputs and depends
on output config, whereas `rule.metric` names a column. Consequence (documented in the spec): a baseline rule over a
numeric-string column evaluates, while a threshold rule over the same column is skipped. No existing rule changes.

**D2 — Exclusion by run id, fetched with one spare.** `listRecent(outputId, k + 1)` where `k = 1` (previous) or `n`
(rolling_avg); drop points with `runId == Some(triggeringRunId)`; take `k`. One run writes at most one point per
Output (one node per Output, one `overwriteRowsWith` per node), so one spare suffices whichever side of the race we
land on. `triggeringRunId = None` → baseline rules skipped (cannot prove exclusion); no real caller passes `None`.

**D3 — Strict sufficiency.** `previous` uses the newest eligible point only (no walking further back); `rolling_avg`
requires exactly `n` eligible points, each with a value. Any missing value, fewer than `k` points, or a zero baseline
in `pct` mode → skip (no breach, no resolve), mirroring the existing "no value to extract" skip. After L2 thinning
"previous" means previous retained point (L1 note); accepted, per D6's previous_run definition.

**D4 — Delta semantics.** `abs`: `current − baseline`; `pct`: `(current − baseline) / |baseline| × 100`; the existing
`breaches(delta, comparator, threshold)` is reused unchanged.

**D5 — Event value.** `upsertFiringInternal` already takes a `JsValue`; baseline breaches pass
`{value, baseline, delta, mode}` (the schema's `value` is unconstrained `{}`). Threshold rules still pass
`JsNumber(value)`.

**D6 — Validation in `AlertRuleService.validateCondition`.** Rules in the alert-rule-crud-api delta: `baseline`
∈ {previous, rolling_avg}; `mode` required ∈ {abs, pct}; rolling_avg `n` an integer 1..100 (JsNumber with no
fractional part); previous forbids `n`; `n`/`mode` without `baseline` → 400; `"baseline": null` counts as present → 400. Evaluation re-parses defensively and
a malformed stored condition throws inside the existing per-rule `recover` (logged, siblings unaffected).

**D7 — Wiring.** `AlertEvaluationService` gains a trailing `outputHistoryRepo: OutputHistoryRepository = null`
parameter (nullable-default convention used across this codebase); `ApiRoutes` passes `outputHistoryRepoOpt.orNull`
— a one-line change. With no repo, baseline rules are skipped and logged at warn. No Main/PipelineRunService edit.

**D8 — Structure.** A new pure `services/alerts/HistoryBaseline.scala` holds parsing (`BaselineCondition`),
the summary accessor, baseline selection/aggregation and delta, unit-testable without a DB.

## Risks / Trade-offs

- [A stored rule created before this change already carries a `baseline` key] → dev DB has 0 such rules (probed:
  `condition ? 'baseline' or ? 'mode' or ? 'n'` = 0 of 0); prod unverifiable from here — a malformed one is
  logged and skipped per rule, never failing a run.
- [Rejecting `n`/`mode` without `baseline` changes create/update for clients sending those keys today] → alerts are
  API-only with no UI/MCP client; accepted to avoid silently ignored config.
- [20-column cap: a metric column beyond the cap has no value] → skip, same on both sides; documented.
- [Two overlapping runs of one pipeline] → "previous" is the newest point by `captured_at` from any OTHER run, which
  may be the overlapping run; exclusion of the triggering run still holds.
- [Metric column absent from the current summary (beyond the 20-column cap, or a mixed column)] → rule skipped and
  logged at info naming rule and column, so a never-firing rule is diagnosable.
- [Extra DB read per baseline rule per run] → one indexed `(output_id, captured_at DESC)` query, limit ≤ 101.

## Planner Notes

- Self-approved: D1 avoids the product escalation the driver flagged, because no existing rule changes behaviour.
- Self-approved: n range 1..100 and strict sufficiency (D3).
- Tests are embedded-Postgres (as the existing alert specs); nothing touches the shared dev DB.
