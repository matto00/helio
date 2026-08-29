## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues:
- Six of seven ACs fully satisfied and traceable to code: numeric `=`/`!=` coercion keyed on row-value
  runtime type; string equality preserved for non-numeric and numeric-looking-string columns
  (`player_id "007"` vs `"7"`); null semantics preserved (D2); every operator audited by enumeration in
  `design.md` D4, matching the `match` arms in `FilterStep.evalCondition` 1:1; tests pin mixed/edge cases.
- The seventh AC ("check whether any existing saved pipeline in production carries a numeric `=` filter")
  is a genuine partial: the executor could only query the local dev DB (0 matching rows) and explicitly
  flagged the lack of production DB access rather than silently omitting the check or fabricating a result.
  No persisted transcript of this query exists anywhere under `openspec/changes/numeric-equality-filter-coercion/`
  despite `tasks.md` 1.2/2.1 claiming "verify by an included transcript" — the transcript was relayed
  out-of-band (to the orchestrator) rather than committed to the change dir. Judgment: this is an
  **acceptable partial**, not a FAIL — no delivery agent in this pipeline has production DB credentials by
  design, the executor did not overclaim, and the underlying code fix is correct and covers every
  behavioral case regardless of the survey's scope. It is a genuine open item for a human with prod access,
  not a code defect. Recommend the human either run the equivalent query against prod directly or file a
  fast-follow ticket to do so before/shortly after this ships, since the fix will change behavior for any
  affected saved pipeline.
- No scope creep — diff touches exactly `FilterStep.scala`, its spec, and planning artifacts.
- `design.md`, `proposal.md`, `files-modified.md`, the commit message, and the `pipeline-filter-op` spec
  delta all match the shipped code precisely (verified line-by-line against the diff): D1 (type-keyed
  coercion), D2 (null asymmetry preserved), D3 (empty value), D4 (operator-by-operator audit table), D5
  (helper placement, not `PipelineRowJson.toDouble`) are all borne out in `FilterStep.scala`'s actual arms.

### Phase 2: Code Review — PASS
Issues: none.
- `npm run check:scala-quality` (imports/qualifiers + file-size budgets, CONTRIBUTING.md's mechanical
  gate): clean — no new inline FQN violations; only pre-existing soft-budget warnings on unrelated files.
- `cd backend && sbt test` (fresh run, this repo's real gate for a backend-only change per HEL-880 — the
  root `npm test` gate is vacuous inside a delivery worktree and was correctly not relied upon):
  3773 tests, 0 failed, 0 canceled — full green, no regressions in filter/sort/aggregate/pipeline suites.
- Independently re-derived the red: checked out `main`'s pre-fix `FilterStep.scala` into the worktree,
  ran `sbt "testOnly com.helio.domain.steps.FilterStepSpec"` — 2 of the 13 new tests genuinely fail on
  unmodified code (`"0"` numeric match: `Vector() was not equal to Vector(Map("years_exp" -> 0.0))`;
  `!=` numeric exclusion: also fails as expected). Restored the fixed file afterward; worktree left clean.
  This independently confirms the red the executor's report claimed, rather than trusting it.
- Tests assert on rows returned by `FilterStep.apply` (materialized `Vector[Map[String, Any]]`), not on a
  helper's return value or a config round-trip — satisfies the "verification by measurement" standard.
- Assertions discriminate, not size-only: e.g. the `player_id "007"` vs `"7"` scenarios assert the exact
  row-set equality (`Vector(Map("player_id" -> "7"))` / `Vector(Map("player_id" -> "007"))`), which would
  fail under a naive symmetric-parse fix that let `"007"` match `"7"` — a size-only assertion (`.size shouldBe 1`)
  would not have caught that regression; this test does.
- The named regression (numeric-looking string columns keep exact string equality) is explicitly covered
  in both directions (`=` and `!=`) with mixed row sets, not just single-row fixtures — this is the
  strongest form of discrimination available for this bug.
- `numericFieldValue` is narrowly scoped to numeric runtime types only (`Int|Long|Float|Double|BigDecimal|
  java.math.BigDecimal`), matching D1/D5 exactly; kept local to `FilterStep` rather than widening the
  shared `PipelineRowJson.toDouble`, avoiding any blast radius to sort/aggregate.
- No dead code, no TODOs, no over-engineering — the change is the minimal diff the design calls for.

### Phase 3: UI Review — N/A
Backend-only change (`FilterStep.scala` + its spec); no `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` files touched.

### Overall: PASS

### Non-blocking Suggestions
- Persist the production-survey query + result (even as "0 rows, dev DB only, no prod access") as a small
  file under the change dir (or append to `files-modified.md`) so the partial is discoverable from the
  repo itself, not only from the orchestrator conversation — future readers of this change directory
  currently see no trace of AC 7's investigation at all.
