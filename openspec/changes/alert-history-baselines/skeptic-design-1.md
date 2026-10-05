## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 2f4956509d0e125414335d99fc44628f6d264cc2 (main; the change dir is untracked, with no code changes yet).
cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/alert-history-baselines/HEL-1278`.

### What I verified (with evidence)

**D1: one reducer for both sides. Sound, verified against the code.**
- Write path (`PipelineRunService.scala:1424-1452`): `nodeJsRows = outcome.rows.map(JsObject(rowMap.map(k -> PipelineRowJson.anyToJsValue(v))))`, where `outcome = nodeOutcomes(nodeKey)`. It then calls `OutputSummaryReducer.summarize(nodeJsRows, o.kind, config)`.
- Alert path (`:1512-1532`): `evaluateForOutput(output.id, nodeOutcome.rows, Some(runId.value))`, where `nodeOutcome = nodeOutcomes.get(sameNodeKey)`. Both sides read the same `Seq[Map[String,Any]]` object (`NodeOutcome(rows: Seq[Row], ...)`, `PipelineExecutionBackend.scala:65`). Using the same `anyToJsValue` conversion therefore gives identical `JsObject`s.
- `OutputSummaryReducer.summarize` (`OutputSummaryReducer.scala:47-57`) calls `columnStats(rows)` with no `kind`/`config` argument, so column stats do not depend on kind or config. `rowCount = rows.size` matches the write path's `rowCount`. Passing `Table` and `JsObject.empty` only nulls `metric`/`series`. The claim that the current `columns` equal what is stored holds.
- No behaviour change for existing threshold rules. The threshold path is unchanged and only rules whose `condition` has a `baseline` key are rerouted. Today `validateCondition` (`AlertRuleService.scala:150-170`) lets arbitrary keys through, so a pre-existing rule that happens to carry `baseline` is the only exposure. The design discloses this (dev 0/0, prod unverifiable, a malformed one is logged and skipped). I accept it. `applyUpdate` re-validates only a supplied `condition` (`:96-99`), so the new strictness cannot break a PATCH that touches only name/severity/enabled on an existing rule. I agree no product escalation is needed.

**D2: exclusion by run id with one spare. Sound.**
- The only history write site is `PipelineRunService.scala:1452` (`grep insertAction|output_snapshot_history` over `backend/src/main`). Each Output maps to exactly one `NodeKey` (`outputsByNodeKey`, `:1413-1420`). Each node does one `overwriteRowsWith` per run, and every entry carries `runId = Some(runId.value)`. So one run writes at most one point per Output, and every point has a non-null run id.
- `listRecent` orders by `(captured_at DESC, id DESC)` on the privileged pool (`OutputHistoryRepository.scala:73-76`). Under READ COMMITTED the evaluation either sees the run's committed point or does not see it. With `k+1` rows, dropping at most one leaves `>= k` older points in both cases. The race is covered.
- Wiring: `AlertEvaluationService` is constructed only in `ApiRoutes.scala:415-419`. `outputHistoryRepoOpt` is declared earlier at `:253`, so no val-init-order null trap. The scheduler reuses `apiRoutes.pipelineRunService` (`Main.scala:275-286`), so scheduled runs get the same wired instance. Leaving Main untouched is correct.

**D6: validation strictness.** Rejecting `n`/`mode` without `baseline` is reasonable: alerts are API-only, I found no `alert` references under `frontend/src` or `helio-mcp/src`, and silently ignored config is worse. Validation runs only on create and on a supplied PATCH `condition`. However, it contradicts a living spec requirement that the delta does not modify (CR1e).

**AC trace (plan level):** previous/rolling breach and resolve → 2.2. Empty history → 2.2. Malformed → 400 on create and update → 2.4. Exclusion test → 2.2 (deterministic: the triggering run's point is inserted directly). Schemas → 1.5 (the three files exist; `create`/`update` enumerate `condition.properties`). Every AC is covered.

### Verdict: REFUTE

The design decisions are sound. The spec deltas are not. They only ADD requirements, so they leave five existing requirements stating the opposite of the new behaviour. After archive, the living specs would contradict themselves. This is a cheap, artifact-only fix.

### Change Requests

1. **Add MODIFIED requirements for the existing statements this change falsifies.** Each item below is currently stated universally in `openspec/specs/*` and is contradicted by the plan:
   a. `alert-evaluation-engine` "Single evaluation entry point", scenario "Entry point requires no pipeline-run context" (spec.md:18-20): "`triggeringRunId = None` → evaluation proceeds normally". Design D2 and the delta skip baseline rules on `None`. Scope that scenario to threshold rules.
   b. `alert-evaluation-engine` "Metric extraction — scalar, aggregate, and count sentinel" (:23-34): it states that `String` values are never coerced, without qualification. The new "Comparable current and baseline values" requirement coerces them for baseline rules. Scope the extraction requirement to rules without `baseline`.
   c. `alert-evaluation-engine` "Threshold comparator evaluation" (:71-74): it compares the extracted value against the threshold. Baseline rules compare the delta. Scope it or cross-reference.
   d. `alert-evaluation-engine` "Breach drives a firing event" (:80-83): "the extracted value (as a `JsNumber`)". D5 passes an object `{value, baseline, delta, mode}` for baseline rules. This is a direct contradiction.
   e. `alert-rule-crud-api` "Create alert rule" (:22-31): "round-trip ... including arbitrary/unknown keys inside `condition`". `baseline`/`n`/`mode` become reserved and validated keys, so this is no longer true for them. Also fix the schema `description` strings that say the service "validates only `comparator` and `threshold`" (`create-alert-rule-request.schema.json` condition description, and the matching text in `update-alert-rule-request.schema.json`/`alert-rule.schema.json`). Add these to task 1.5.

2. **Name the mutations each exclusion and selection test must go red under (task 2.2).** As written, "each red under a named mutation first" leaves the mutations unnamed. At minimum, the deterministic exclusion test must fail under each of:
   (i) removing the `runId == triggeringRunId` filter;
   (ii) `listRecent(k)` instead of `k + 1`. This only goes red if the fixture has **exactly** `n` older points plus the current-run point for `rolling_avg`, and exactly 1 older point plus the current-run point for `previous`. With more older points the spare is never needed and the mutation survives.
   Choose values so the self-included point changes the verdict: for example, the current point equal to the current value makes delta 0 → no breach, where the test asserts breach. State this in tasks.md.
   Also state that 2.3 (the PipelineRunService end-to-end test) is **not** a red proof of exclusion. Whether the current point is visible there is a race, so mutation (i) fails only intermittently. It is a seam/integration check only, and must not be cited as the AC4 proof.

3. **Fix the rolling-average resolve scenario's arithmetic, or make its history explicit** (`specs/alert-evaluation-engine/spec.md`, "Rolling-average breach and resolve"). "A current total of `95` (−5%) resolves" assumes the baseline is still 100. In a real second run, the breaching run's own point (70) is now the newest prior point. The 3-point mean becomes (70+100+110)/3 ≈ 93.3, so 95 is about +1.8%. It still resolves, but the stated −5% is wrong for the end-to-end case. Either state that the resolve evaluation's history is `{100,110,90}` (direct evaluation with fixed history) or give the real figures. Otherwise the implementer cannot tell which history the scenario means.

### Non-blocking notes

- A `"baseline": null` key: say explicitly whether it counts as "carries a `baseline` key" (400) or as absent. I suggest 400 to match the strict stance.
- The 20-column cap means a baseline rule on the 21st or later numeric column (sorted by name) is silently and permanently skipped, and a column with a single non-numeric non-blank cell has no stats at all. That differs from a threshold rule, which sums the numeric cells. Consider logging at debug or info when the metric column is absent from the current summary, so a never-firing rule can be diagnosed. Do not reject at create: column presence is a runtime property.
- If two runs of the same pipeline overlap, "previous" is the newest by `captured_at` among other runs, which may be the overlapping run. Exclusion is still correct. This is just a semantic edge worth one sentence in design Risks.
- D3: `rolling_avg` with a point whose summary predates a column, so `columns[metric]` is absent, means skip. That is consistent with strict sufficiency and is already covered by "any missing value → skip".

### Gate notes
- No screenshots or measurement artifacts were captured (design gate). No mtime-ordering evidence is relied on.
