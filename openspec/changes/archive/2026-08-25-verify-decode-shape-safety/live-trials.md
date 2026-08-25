# HEL-671 Live-Trial Evidence (design.md D1, tasks.md 2.5)

Captured cycle-2, re-run in response to evaluation-1.md change request 1 (original cycle-1 trials were
performed but their transcript was not preserved as run evidence). All calls are real `POST
/api/refinements` requests against this worktree's own backend (`http://localhost:9010`), authenticated as
`matt@helio.dev`, using the real `ANTHROPIC_API_KEY` from `backend/.env`. Each step kind's throwaway static
data source(s) + one-step pipeline were created via the real backend API immediately before its trials and
deleted immediately after (shared dev Postgres — see cleanup confirmation at the bottom).

For every trial: the exact prompt sent, the resulting `PatchSet` edit's `patch.config` verbatim, and a
verdict against the real decoder's expected shape (`JoinConfig`/`PivotConfig`/`UnpivotConfig`/
`WindowConfig`, `backend/src/main/scala/com/helio/domain/steps/*.scala`).

## join (probe target: `joinKey`/`joinType` — no downstream referential check backstops these, unlike
`rightDataSourceId`, per design.md's Premise Correction)

Pipeline: `HEL671b Join Pipeline` (source `HEL671b Orders`, static), one `join` step against
`HEL671b Customers` (static), initial config `{"rightDataSourceId": "<right-id>", "joinKey": "customerId",
"joinType": "inner"}`.

### Trial 1
**Prompt:** "Change the join so it joins on customerName instead of customerId, and use a left join instead
of inner."
**Returned `patch.config`:**
```json
{ "joinKey": "customerName", "joinType": "left", "rightDataSourceId": "f5416ea6-8c4e-4784-b224-85cfb206309a" }
```
**Verdict: PASS** — `joinKey`/`joinType`/`rightDataSourceId` all non-empty strings, correct shape for
`JoinConfig`. No silent default.

### Trial 2
**Prompt:** "I want to join on both customerId and orderId together as the join key, and set the join type
to full outer."
**Returned `patch.config`:**
```json
{ "joinKey": "customerId,orderId", "joinType": "full", "rightDataSourceId": "f5416ea6-8c4e-4784-b224-85cfb206309a" }
```
**Verdict: PASS (shape)** — `joinKey` is a non-empty string (comma-joined, since `JoinConfig.joinKey` has no
multi-column shape to tempt into — the model correctly stayed within the single-string field, it did not
emit e.g. an array). Note: `joinType: "full"` is not one of `JoinStep`'s supported types (`inner`/`left`)
and will raise `IllegalArgumentException` at execute time — this is a wrong VALUE, not a wrong SHAPE, and
is caught loudly at execute time rather than silently degrading; out of this ticket's decode-shape-safety
scope (see design.md Non-Goals — decoder/execute-time value validation is not this ticket's concern).

### Trial 3
**Prompt:** "Just switch the join to be a left join, keep everything else the same."
**Returned `patch.config`:**
```json
{ "joinKey": "customerId,orderId", "joinType": "left", "rightDataSourceId": "f5416ea6-8c4e-4784-b224-85cfb206309a" }
```
**Verdict: PASS** — correct shape; `joinKey` carried over from trial 2 unchanged (no silent reset to `""`).

**join: 3/3 trials PASS — no live-reproduced shape gap.**

## pivot (probe target: `index` non-array shape, `column`/`values`/`agg` missing/wrong type)

Pipeline: `HEL671b Pivot Pipeline` (source `HEL671b Sales`, static: region/quarter/revenue), one `pivot`
step, initial config `{"index": ["region"], "column": "quarter", "values": "revenue", "agg": "sum"}`.

### Trial 1
**Prompt:** "Also group by quarter in addition to region for the pivot's grouping, and change the
aggregation to average revenue."
**Returned `patch.config`:**
```json
{ "agg": "avg", "column": "quarter", "index": ["region", "quarter"], "values": "revenue" }
```
**Verdict: PASS** — `index` stayed a `Vector[String]` (now 2 entries), `column`/`values`/`agg` all non-empty
strings matching `PivotConfig`'s real shape. No collapse to `Vector.empty` or `""` default.

### Trial 2
**Prompt:** "Change the pivot to count rows instead, and switch the values column to be 'revenue'
explicitly written as the string revenue."
**Returned `patch.config`:**
```json
{ "agg": "count", "column": "quarter", "index": ["region", "quarter"], "values": "revenue" }
```
**Verdict: PASS** — same shape check as above; `index` from trial 1 preserved.

**pivot: 2/2 trials PASS — no live-reproduced shape gap.**

## unpivot (probe target: `idVars`/`valueVars` non-array shape, `varName`/`valueName` missing/wrong type)

Pipeline: `HEL671b Unpivot Pipeline` (source `HEL671b Wide Sales`, static: region/q1/q2), one `unpivot`
step, initial config `{"idVars": ["region"], "valueVars": ["q1", "q2"], "varName": "quarter", "valueName":
"revenue"}`.

### Trial 1
**Prompt:** "Rename the output columns: call the variable column 'period' and the value column 'amount'
instead."
**Returned `patch.config`:**
```json
{ "idVars": ["region"], "valueName": "amount", "valueVars": ["q1", "q2"], "varName": "period" }
```
**Verdict: PASS** — `idVars`/`valueVars` both remained `Vector[String]`; `varName`/`valueName` both
non-empty strings, matching `UnpivotConfig`'s real shape.

### Trial 2
**Prompt:** "Only unpivot q1 for now, don't include q2. Keep region as an id column."
**Returned `patch.config`:**
```json
{ "idVars": ["region"], "valueName": "amount", "valueVars": ["q1"], "varName": "period" }
```
**Verdict: PASS** — `valueVars` correctly shrunk to one entry (still a `Vector[String]`, not a bare string);
`idVars` preserved.

**unpivot: 2/2 trials PASS — no live-reproduced shape gap.**

## window (probes BOTH mechanisms: `orderBy` item-level flatMap-drop, `partitionBy` field-level default)

Pipeline: `HEL671b Window Pipeline` (source `HEL671b Sales`, reused from pivot's data source), one `window`
step, initial config `{"partitionBy": ["region"], "orderBy": [{"field": "revenue", "direction": "desc"}],
"function": "row_number", "field": null, "outputColumn": "rank", "offset": null}`.

### Trial 1 (orderBy item-level)
**Prompt:** "Order the ranking by quarter ascending first, then by revenue descending as a tiebreaker."
**Returned `patch.config`:**
```json
{
  "function": "row_number",
  "orderBy": [ { "direction": "asc", "field": "quarter" }, { "direction": "desc", "field": "revenue" } ],
  "outputColumn": "rank",
  "partitionBy": ["region"]
}
```
**Verdict: PASS** — both `orderBy` entries present as valid `SortKey`-shaped objects (`{field, direction}`);
neither item was dropped by the `flatMap(...).toOption` mismatch pattern.

### Trial 2 (partitionBy field-level)
**Prompt:** "Partition by both region and quarter instead of just region, and switch the function to a
running sum of revenue."
**Returned `patch.config`:**
```json
{
  "field": "revenue",
  "function": "sum",
  "orderBy": [ { "direction": "asc", "field": "quarter" }, { "direction": "desc", "field": "revenue" } ],
  "outputColumn": "rank",
  "partitionBy": ["region", "quarter"]
}
```
**Verdict: PASS (shape)** — `partitionBy` correctly grew to `["region", "quarter"]` (still a
`Vector[String]`, no field-level default to `Vector.empty`); `field: "revenue"` is a non-empty string,
correctly populated (not defaulted to `None`/absent). Note: `function: "sum"` is not one of `WindowStep`'s
supported functions (`row_number`/`rank`/`dense_rank`/`running_sum`/`lag`/`lead` — the model should have
said `"running_sum"`) and will raise `IllegalArgumentException` at execute time. Same as the join trial 2
note above: a wrong VALUE caught loudly at execute time, not a wrong SHAPE silently accepted — out of this
ticket's decode-shape-safety scope. Reproduced consistently across cycle-1 and cycle-2 runs of this same
prompt, so it is a real (if out-of-scope) minor prompt-grounding gap worth flagging as a spinoff candidate
(the worked `WindowStepExample`'s prose in `RefinementEditShape.scala`'s `Description` text already lists
the correct function name; the model doesn't always pick it for this specific "running sum" phrasing).

### Trial 3 (empty partitionBy)
**Prompt:** "Actually remove the partitioning entirely - compute the rank across the whole dataset, not per
region. Keep the sort by revenue descending."
**Returned `patch.config`:**
```json
{
  "field": "revenue",
  "function": "sum",
  "orderBy": [ { "direction": "desc", "field": "revenue" } ],
  "outputColumn": "rank",
  "partitionBy": []
}
```
**Verdict: PASS** — `partitionBy: []` here is a deliberate, correctly-encoded empty vector (the user
explicitly asked for no partitioning, which is valid `WindowConfig` semantics per `WindowStep.scala`'s own
doc comment: "an empty `partitionBy` collapses every row into one partition"), not a silent decode-time
default from a missing/malformed field.

### Trial 4 (multi-key orderBy, SQL-phrased)
**Prompt:** "Sort ascending by region, then within each region sort by quarter ascending too, so it's a
two-level sort like a SQL ORDER BY region ASC, quarter ASC."
**Returned `patch.config`:**
```json
{
  "field": "revenue",
  "function": "sum",
  "orderBy": [ { "direction": "asc", "field": "region" }, { "direction": "asc", "field": "quarter" } ],
  "outputColumn": "rank",
  "partitionBy": []
}
```
**Verdict: PASS** — both `orderBy` entries correctly shaped; no item dropped despite the SQL-flavored
phrasing that could have tempted a different (wrong) key structure.

**window: 4/4 trials PASS — no live-reproduced shape gap** (the `function` value-correctness note above is
a real but out-of-scope observation, not a decode-shape defect).

## Overall verdict

**CORRECTED (cycle 3, skeptic-final-1.md CR-3)** — the original wording here overclaimed. **11 non-ablated
live trials across join/pivot/unpivot/window produced correctly-shaped configs; this does NOT establish
that the existing generic "config must match current shape" prompt rule was load-bearing in any of them.**
Every trial in this file is a *positive* observation only: no trial was run with the prompt rule/worked
examples absent or evaded (no ablation), and none hand-constructs a wrong-shape config to check whether
`preview` would have accepted it. As the skeptic's final-gate review correctly identified, "11/11 PASS"
alone cannot distinguish "the prompt rule is load-bearing" from "these particular prompts never actually
stressed the tolerant decode path" — several of the 11 prompts above (e.g. join trial 3's "just switch to a
left join," unpivot trial 1's column rename) are edits any competent model would shape correctly with or
without the rule.

**The deterministic evidence that the underlying tolerance is real, and that `preview` does not catch it on
its own, now lives in code, not narrative:**
- `RefinementEditShapeSpec.scala`'s new "hand-constructed WRONG-SHAPE config (negative control)" test group
  (4 tests, one per step kind) decodes a deliberately wrong-shape config through the REAL
  `JoinConfig`/`PivotConfig`/`UnpivotConfig`/`WindowConfig` decoders and asserts the decoded value IS
  silently degraded (empty vector / `""` default / dropped item) — proving the tolerance exists.
- `PatchSetPreviewServiceSpec.scala`'s new join-specific test ("PASS preview for a wrong-shape join edit
  missing joinKey ... skeptic-final-1.md CR-2") drives that same class of hand-constructed wrong-shape edit
  through the REAL `PatchSetPreviewService.preview` (which reuses `PatchSetApplyResolvers.
  validateEmbeddedStepReferences` verbatim) and asserts it returns `Right` (accepted) despite the degraded
  decode — proving the ticket's central claim ("a wrong-shape edit passes preview and would silently
  corrupt the pipeline") as a tested fact, not a code-read inference.

Given that deterministic proof, the 11 live trials above retain their original, narrower value: they show
that for the SPECIFIC adversarial framings tried in this cycle, the model did not happen to produce a
wrong-shape edit — consistent with, but not proof of, the prompt rule doing useful work. No live-reproduced
gap requires a fix beyond what design.md's D1/3.1 already mandates shipping unconditionally (the four new
worked examples in `RefinementEditShape.scala` + their decoder-value regression tests, already committed).

The `function: "sum"` vs `"running_sum"` value-mismatch observed in window trials 2-4 remains flagged above
as a spinoff candidate — real, reproducible, but a decoder VALUE-validation gap (caught loudly at execute
time), not the decode-SHAPE-safety defect class this ticket targets.

## Cleanup confirmation

All throwaway resources created for this cycle's trials were deleted immediately after their step kind's
trials completed, confirmed via `204 No Content` on each `DELETE`:
- Pipelines: `HEL671b Join Pipeline`, `HEL671b Pivot Pipeline`, `HEL671b Unpivot Pipeline`,
  `HEL671b Window Pipeline` — all 4 deleted (204).
- Data sources: `HEL671b Orders`, `HEL671b Customers`, `HEL671b Sales`, `HEL671b Wide Sales` — all 4
  deleted (204).
