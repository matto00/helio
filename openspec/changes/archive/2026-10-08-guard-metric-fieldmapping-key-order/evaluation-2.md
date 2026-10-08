## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: b6ce14d1ad17cdff4f72cdda718dc373ea5f9af7. The incremental diff over cycle 1's reviewed commit
(87ac40930..b6ce14d1a) touches 7 files: 4 test files, `design.md`, `files-modified.md`, and the committed `evaluation-1.md`.
There are still zero production files.

### Phase 1: Spec Review — PASS

Both cycle-1 change requests are resolved.
- **CR1, `design.md` D4:** rewritten as "corrected by probe". It states that the parsed `JsObject.fields` iterates
  alphabetically, so `value` is never first at `metricField`. That includes the value-first-JSON-text case, which still
  goes red under a positional pick. This matches the cycle-1 mutation evidence.
- **CR2, `design.md` D3:** now explicitly says the precondition does NOT detect a change in jsonb ordering. It guarantees
  that `metricField` receives a non-value-first map. That is accurate.

Every other Phase-1 item from cycle 1 is unchanged and still passes: ACs, tasks, scope, C1–C3, and the delta spec.

### Phase 2: Code Review — PASS

**Behavioral audit of the incremental diff:**
- `OutputSummaryReducerSpec.scala:159` renames a case string only.
- In the frontend tests, three MAPPINGS entries are renamed to "value-first (baseline control)" and one comment is
  rewritten. Two precondition comparisons changed from `name === "value-first"` to `name.startsWith("value-first")`.
  That change is required by the rename and selects exactly the same single case, so semantics are unchanged.
- No fixture values, assertions, or production code changed.

Because the diff is non-behavioral, a full `sbt testFull` re-run isn't warranted: no Scala production or test logic
changed, only a test-name string. Cycle 1's full run (6138 passed) still covers it. I re-ran the targeted gates instead
(nice -n 19, max 3 workers):
- `npm run lint`: 0 warnings.
- `format:check`: clean.
- `typecheck`: clean.
- Jest `metricHistoryView|keyOrder|aggregate.fixture`: 4 suites, 129/129 passed.
- `sbt "testOnly *OutputSummaryReducerSpec *OutputSummaryReducerSeamSpec *OutputFilteredMetricRoutesSpec"`: 120/120
  passed. The renamed "(value-first JSON text)" cases ran.

**Mutation re-run, client resolver** (`Object.values(mapping)[0]`). I re-ran it to confirm the `startsWith` edit didn't
flip any case's role:
- 21 HEL-1182 tests failed: 12 `MetricOutputPanel` and 9 `resolveServerMetricField`, the same as cycle 1.
- No "baseline control" case failed.
- I reverted with `git -C <wt> checkout -- <file>`, and the tree was clean afterwards.

### Phase 3: UI Review — N/A

Unchanged from cycle 1: the change is test-only and the running app is byte-identical to main.

### Overall: PASS

### Non-blocking Suggestions
- `OutputSummaryReducerSpec.scala:159`: the renamed key now breaks the column alignment of the neighbouring `->` arrows.
  This is cosmetic, and the Scala code-quality check passed via the gates.
