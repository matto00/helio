## Standing Constraints

## 1. Probes and reference table (before code)
- [x] 1.1 Confirm which ops already emit an unknown-field `validationError` at analyze (D3 exclusion list); record the final list in `files-modified.md` notes or a test comment.
- [x] 1.2 Build the per-op input-field reference table (D3) from each op's config class and runtime step, including "no field" values (empty / wildcard / count-without-field). Also identify every op whose run-time output column NAMES depend on data and are not projected (pivot known) — these mark name-incomplete (D3a 3b).
- [x] 1.3 Probe runtime value representations per canonical type for join keys (D4); record the family mapping and the evidence (test or REPL transcript). Confirm integer-vs-float runtime match behaviour. Confirm each TYPE-TRUSTED allow-list op (D3a) produces run-time values matching its projected types; drop any entry not confirmed. Design-gate r3 flagged two likely drops: `fillnull` (constant strategy writes the raw fill string; mean/median write a Double) and `compute` (falls back to the user-declared type when inference returns nothing). Probe integer-family behaviour for Int, Long and BigDecimal under `groupBy` hashing, not just `==`.
- [x] 1.4 Reproduce each of the three HEL-1069 shapes against current main analyze (unit-level via `PipelineService`/`analyzeNodes` or HTTP) and show no warning exists today.

## 2. Domain warning pass (red first)
- [x] 2.1 Add failing tests in a new `AnalyzeSchemaWarningsSpec` for each class: missing field (incl. the `count(amount)` over `(category,total)` case), join-key type mismatch (string CSV key vs integer lane key), join column rename (both lanes carry `total`); plus negatives: matching key types, disabled step, step with `validationError`, excluded op with unknown field, empty input schema, unresolved secondary, "no field" values; completeness negatives (D3a): (a) union with a source-kind secondary then a step referencing a secondary-only column → no warning, (b) join with an unresolvable source secondary then a right-column reference → no warning, (c) empty root → column-adding step → reference to a source column → no warning, (d) a descendant of a step with `validationError` → no warning, (e) aggregate under an incomplete input resets name-completeness (its child referencing a missing alias DOES warn), (f) join key type check suppressed when either side is type-incomplete (lookup placeholder column as key), (g) pivot followed by a reference to a data-derived `<values>_<v>` column → no warning, (h) CSV string `id` → aggregate with group-by `{type: integer}` → join on `id` to a string-keyed lane → no `join-key-type-mismatch`. Capture the red run.
- [x] 2.2 Implement `AnalyzeSchemaWarnings` (D2–D5, D3a, D7) in `domain/engine/AnalyzeSchemaWarnings.scala`; minimal visibility changes only in `PipelineAnalyzeService.scala`. Deterministic ordering.
- [x] 2.3 Tests green.

## 3. Wire + service integration
- [x] 3.1 Add `AnalyzeWarningResponse` + `warnings` to `PipelineAnalyzeResponse` and `PipelineAnalyzeProposalResponse` (always present), and optional `warnings` to `ConciseAnalyzeNode`; update spray-json formats.
- [x] 3.2 Wire `PipelineService.analyze`, `analyzeConcise`, `analyzeProposal` to call the pass on the post-overlay projections with the same inputs passed to `analyzeNodes`.
- [x] 3.3 Route/service-level tests: persisted analyze, proposal analyze and concise analyze each surface a warning (red first); clean pipeline returns `"warnings": []`.

## 4. Non-blocking guards (D6)
- [x] 4.1 Guard test: a pipeline exhibiting all three shapes has `costVerdict.canRun == true`, no warning-derived reasons, no `validationError`; `stepConfigProblem` returns `None` for those configs; a step write with such a config is accepted. Show each guard failable by a temporary mutation (document, then revert).
- [x] 4.2 Run the HEL-1279 guard test and the auto-run trigger specs unmodified; must be green.
- [x] 4.3 `PipelineAnalyzeConciseByteBudgetSpec` green unchanged.

## 5. Contract surfaces
- [x] 5.1 Update `schemas/pipelines/pipeline-analyze-response.schema.json`, `pipeline-analyze-proposal-response.schema.json`, `pipeline-analyze-concise-response.schema.json`; run the schema-drift check.
- [x] 5.2 helio-mcp: `types.ts` (`AnalyzeWarning`, fields on full/proposal/concise), `analyze_pipeline` + `analyze_pipeline_proposal` descriptions; audit every helio-mcp path that reshapes analyze output so `warnings` is not dropped; helio-mcp tests (description + passthrough).
- [x] 5.3 Frontend analyze types: required `warnings` on full/proposal response types, optional on concise nodes; typecheck.

## 6. Verification
- [x] 6.1 Backend: `sbt testFull` (or `testOnly` for touched specs plus the full suite once) — never bare `sbt test`.
- [x] 6.2 helio-mcp + frontend: lint, typecheck, tests.
- [x] 6.3 Live probe: on the worktree's backend, create a pipeline exhibiting each shape as a fresh test user, `GET /api/pipelines/:id/analyze`, record the warnings and `canRun: true`; record every created dev-DB row id (user, sources, pipelines) as residue.
