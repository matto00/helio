## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 2f4956509d0e125414335d99fc44628f6d264cc2 (main). The change dir is untracked, and there are no code changes yet.
cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/alert-history-baselines/HEL-1278`.

### What I verified (with evidence)

**`openspec validate alert-history-baselines --type change` passes.** Output: `Change 'alert-history-baselines' is valid`.

**Round-1 CR1 (the five contradicted living statements): fixed.** I compared each MODIFIED block against `openspec/specs/*`.
- a. "Single evaluation entry point": the `None` scenario is now scoped to non-baseline rules, and baseline rules are skipped. The header text is identical to the living spec (`alert-evaluation-engine/spec.md:11`).
- b. "Metric extraction": prefixed "For a rule whose `condition` carries no `baseline` key". All 7 living scenarios (`:36-69`) are preserved verbatim, so nothing is lost on archive. It also corrects the stale `evaluateForDataType` name.
- c. "Threshold comparator evaluation": scoped, with a new "Baseline rules compare the delta" scenario. The comparator matrix is kept.
- d. "Breach drives a firing event": now `JsNumber` for threshold rules and the object for baseline rules. Both scenarios are kept.
- e. `alert-rule-crud-api` "Create alert rule": `baseline`/`n`/`mode` are carved out as reserved. All 4 living scenarios are kept. Task 1.5 now also fixes the schema description strings. I confirmed that the stale text exists today at `schemas/alerts/create-alert-rule-request.schema.json:18` ("validates only `comparator` and `threshold`") and at `alert-rule.schema.json:5`.

**Round-1 CR2 (named mutations): fixed.** tasks.md 2.2 names M1-M5, and 2.4 names M6. Standing constraint C1 requires a fixture of exactly k older points plus the current-run point, with values chosen so that self-inclusion flips the verdict. C1 also states that 2.3 is a seam check, never the AC4 proof. `workflow-state.md` records C1 as a constraint.

**Round-1 CR3 (rolling-average resolve arithmetic): fixed.** The scenario now gives the real second-run history {70, 100, 110}. The mean is 93.33, and (95 − 93.33)/93.33 ≈ +1.79%, which is not below −20%, so the rule resolves. The breach leg is (70 − 100)/100 = −30% < −20%, so it breaches. I checked both figures.

**Non-blocking notes from round 1: addressed.** D6 and the crud delta now say `"baseline": null` → 400. design.md Risks now covers overlapping runs and logging at info when the metric column is absent from the current summary.

**Design claims re-checked against live code, independently of round 1:**
- `AlertEvaluationService.scala:60-67`: `extractMetric` does not coerce strings and sums typed numbers. `:118-150` skips on `None`, firing passes `JsNumber(value)`, and the per-rule `recover` is at `:106`. These match design Context, D1 and D5.
- `OutputSummaryReducer.scala:48-80`: `summarize` calls `columnStats(rows)` with no kind or config dependency. A column is numeric only if every non-null, non-blank cell coerces. The cap is 20 columns, taken from a name-sorted list. `sum` is emitted through `num`, so a non-finite sum is `JsNull`. That is covered by D3's "any missing value → skip", and I mention it in a note below.
- `PipelineRunService.scala:1424-1452`: the history write site converts rows with `PipelineRowJson.anyToJsValue` and calls `summarize(nodeJsRows, o.kind, config)` with `runId = Some(runId.value)`. It is the only `OutputHistoryInsert(` construction in `backend/src/main` (grep). `:1512-1532`: `alertEvaluation` is a separate `val` Future that calls `evaluateForOutput(output.id, nodeOutcome.rows, Some(runId.value))` on the same node outcome. This confirms the D1 identity and the D2 race.
- `OutputHistoryRepository.scala:74-77`: `listRecent` sorts by `(capturedAt desc, id desc)` and takes `limit` rows on the system context. D2's k+1 fetch is sound.
- `ApiRoutes.scala:253` (`outputHistoryRepoOpt`) is declared before `:415-419` (`alertEvaluationServiceOpt`), so the D7 one-line wiring is safe.
- `AlertRuleService.scala:96-99`: `applyUpdate` re-validates only a supplied `condition`, so stricter validation cannot break a name/severity/enabled-only PATCH.

**AC trace (plan level):**
- AC1 (previous/rolling breach and resolve): tasks 2.2 and 2.1, and the spec scenarios.
- AC2 (empty history): tasks 2.2 and M5, and the "Empty history" scenario.
- AC3 (400 on create and update): task 2.4 and M6, and the "Baseline condition validation" requirement.
- AC4 (current run excluded): C1 with M1/M2 in task 2.2.
- AC5 (schemas): task 1.5.

All five ACs are covered.

### Verdict: REFUTE

One more living-spec contradiction remains. It is the same defect class as round-1 CR1, which this round accepted as blocking. Round 1 did not list it, but the obligation was that no living requirement keeps stating the opposite of the new behaviour, and this one does. It sits on an acceptance-criteria path: the resolve half of AC1. The fix is artifact-only and small.

### Change Requests

1. **Add a MODIFIED "Clearing the condition auto-resolves the active event" requirement** to `specs/alert-evaluation-engine/spec.md`.
   - The living text (`openspec/specs/alert-evaluation-engine/spec.md:95-98`) says the system "SHALL resolve a rule's active `AlertEvent` ... whenever the rule's metric was successfully extracted (not skipped per the zero-rows scenario above) and the current evaluation does not breach."
   - The new "Insufficient baseline never breaches" requirement says a baseline rule is skipped, with no breach and **no auto-resolve**, in several cases where the current metric *was* successfully extracted and nothing breaches:
     - no eligible prior point;
     - fewer than `n` points;
     - a selected *history* point lacking the column;
     - `pct` mode with a zero baseline.
   - Read literally, the living requirement mandates a resolve in those cases and the new one forbids it. Which one wins decides whether a firing baseline event resolves when history later becomes insufficient (for example after L2 thinning). An implementer and a test author could each pick a different answer.
   - Fix: scope the resolve condition the same way as the other MODIFIED blocks. Resolve happens when the rule produced a comparison and the comparison does not breach:
     - for a threshold rule, the metric was extracted;
     - for a baseline rule, both the current value and the baseline were resolved per "Insufficient baseline never breaches".
   - Keep both living scenarios ("Clear transitions firing to resolved", "No active event, no breach — no-op") verbatim.
   - Optionally add a scenario: an active baseline event plus insufficient history → the event stays firing.

### Non-blocking notes

- **C1 / M2 fixture ordering.** M2 (`listRecent(k)`) only goes red if the directly-inserted current-run point has the **newest** `captured_at` (or ties and sorts first by `id`). If the test inserts it with an older timestamp, the `k` fetch never sees it, and M2 survives. Say "newest `captured_at`" in C1 or task 2.2. This also mirrors the real race, where the current point is always newest.
- **"Previous-run breach and resolve" wording.** "a later run whose total is within 10 of its own previous point resolves" is loose: under `gt 10`, a large drop also resolves. It is correct as an example, but a concrete number such as 125 vs. previous 120 would be crisper.
- **Non-finite sums.** A stored or current summary column can have `sum: null` (non-finite, via `OutputSummaryReducer.num`). The accessor must treat `JsNull` as no value (→ skip), not throw. A throw would only reach the per-rule `recover`, which logs at error. Worth one case in HistoryBaselineSpec.

### Gate notes
- Design gate: no screenshots or measurement artifacts were captured, and nothing relies on mtime ordering.
