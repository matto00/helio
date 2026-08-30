## 1. Establish the static predicate (red first)

- [x] 1.1 Add `ExpressionEvaluator.parseProblem(expr: String): Option[String]` per design Decision 1 — `parse`, with the `isDollarPrefixError` → `parseLegacy` fallback, evaluation removed. Comment it as the write/run-path twin of `evaluate`'s parse arm, and comment `evaluate` pointing back, per the Risks section.
- [x] 1.2 **Proof test.** Assert `parseProblem("stats.adp_ppr - stats.pts_ppr")` is `Some(..)` with a non-empty message. Run this before 1.1 exists to confirm it fails to compile/red, and record that. This is the production expression; the claim that it fails *both* grammars is a code reading and must be measured, not assumed.
- [x] 1.3 **Guard test.** Drive `parseProblem` and `evaluate` over the same expression set — strict-valid, legacy-only (bare identifier), unparseable, empty — and assert they agree on parseability for every entry (`parseProblem` returns `None` exactly when `evaluate` does not return `ParseError`). Label as a guard against the two drifting; failable by mutating `parseProblem` to drop the legacy fallback.

## 2. Write path

- [x] 2.1 **Proof test (red first).** Against `ComputeStep.companion.validateRawConfig`, assert a config with the production expression yields `Some(msg)` containing the parser's message. Show red on current `main` (today it returns `None`).
- [x] 2.2 **Proof test (red first).** End-to-end at a real write surface: `POST` a `compute` step with the production expression and assert 422 and that nothing was stored. Show red first — today it 200s. Use the existing step-create route test harness, not a direct call to the companion.
- [x] 2.3 Implement the `validateRawConfig` override per design Decision 3, composed with `super` and short-circuiting on `expression.trim.isEmpty`.
- [x] 2.4 **Guard test.** Empty and whitespace-only expressions still save (hazard 2 — production holds one). Its red comes from mutation (omit the `trim.isEmpty` short-circuit), not from un-fixed `main`, so it is a guard, not proof — the behaviour it protects already holds today. Demonstrate the mutation red anyway.
- [x] 2.5 **Guard test.** A legacy bare-identifier expression that fails strict `validate` but parses under `parseLegacy` is still accepted at create (design Decision 1). Its red comes from mutation (gate on `validate` instead of `parseProblem`), so it counts as a guard, not proof — but it is the single most valuable guard in the change, since it is the specific regression Decision 1 exists to prevent, and the test is worthless unless that red is demonstrated.
- [x] 2.6 Confirm by enumeration that the override reaches all four write surfaces (`PipelineService:494`, `PipelineService:670`, `PipelineProposalService:187`, `PatchSetApplyResolvers:240`) — re-derive the list from the tree rather than trusting this one. Add a guard test at update and at one apply surface.

## 3. Run path

- [x] 3.1 **Proof test (red first).** Store a `compute` step with the production expression directly through the repository (bypassing the new write gate, as a pre-existing row would), run the pipeline, and assert the run fails with a message naming the step id, `compute`, and the parse error. Show red first — today the run succeeds.
- [x] 3.2 **Proof test, on materialised rows (red first).** Same setup, and assert the output DataType's rows do **not** contain the computed column set to `null` for every row. This is the ticket's measurement requirement: assert on materialised rows, never on the stored-config round-trip, which is exactly what the bug produces.
- [x] 3.3 Implement the `requiredConfigProblems` override per design Decision 4, with `missingRequired` taking precedence.
- [x] 3.4 **Guard test.** An empty expression reports missing-required, not a parse error (ordering in 3.3 is load-bearing). Failable by swapping the two branches.
- [x] 3.5 **Guard test.** Two assertions with *different* mechanisms — do not conflate them:
  - Analyze's `validationError` **contains the parser's message** (assert by substring, not equality). It arrives via `shapeRejection` at `PipelineAnalyzeService:128` — the Decision 3 write-path override — because that branch short-circuits `requiredConfigProblems` at `:130-132`. Expect Decision 3's `"compute: invalid expression: "` prefix here, per design Decision 4's recorded two-prefix trade.
  - Preview fails with the attributed error rather than returning blank-column rows. This one *does* come from Decision 4's hook (`previewStep` → `executeWithStepCounts` → `InProcessPipelineEngine:145`).

## 4. Per-row semantics stay distinct, and the read path stays tolerant

- [x] 4.1 **Proof test, on materialised rows.** A parseable expression over a row set containing a divide-by-zero row and a null-operand row: the run **succeeds**, those rows' values are `null`, and every other row holds its computed value. Assert on the rows, not on a function return. This is acceptance criterion 3 and is the test that proves static and per-row failures were not collapsed.
- [x] 4.2 Hoist the parse out of `ComputeStep.apply`'s row loop per design Decision 6, keeping `apply` total and its per-row semantics identical. If exposing an AST-level entry point widens `ExpressionEvaluator`'s surface unacceptably, drop this task and say so — the correctness half of the change does not depend on it. **If dropped, delete the sentence "The expression SHALL be parsed once per step evaluation rather than once per row" from the `pipeline-compute-op` delta in the same commit**, or the change ships a SHALL it does not meet.
- [x] 4.3 **Guard test.** Read back a stored step whose expression is unparseable through the repository read path and assert a step object is returned, not a raised exception (hazard 1). Failable by adding a `parseProblem` check to `ComputeConfig.decode`.

## 5. Verification and reporting

- [x] 5.1 `cd backend && sbt test` — full suite green. Frontend is untouched; the jest gate is vacuous inside a worktree (HEL-880), so do not cite a green root `npm test` as evidence for anything.
- [x] 5.2 Report the evidence split explicitly: which tests are **proof** (shown red before the fix) and which are **guards** (failable by mutation, not counted as proof), with the count of each and how each red was produced. Do not adopt any count asserted in the ticket or the brief — report what was actually observed.
- [x] 5.3 Re-read this change's prose (proposal, design, spec deltas) against the final code and correct anything that drifted, including any line number or call-site list.
