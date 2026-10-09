## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `d59a65ca0e317531e318bb2c7a4d6726f89579f8` (HEAD; worktree clean). Review base resolved live:
`0a4badcfb33d76ee02ca4be503fae761f1ed9f82`. Spawn-cwd guard: `READY`.

Evaluator evidence (persisted, durable):
- `/home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/eval-c1/eval-testfull.txt` — own `testFull`
- `/home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/eval-c1/mutA.txt` — mutation run A
- `/home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/eval-c1/mutB.txt` — mutation run B
- `/home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/eval-c1/baseProbe.txt` — base-commit save-path probe
- `/home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/eval-c1/live.sh` + `live-output.txt` — own live run

### Phase 1: Spec Review — PASS
- AC1 (`coalesce(a, b, ...)` returns first non-null; common-type inference; HEL-1315 list + parity pattern; error-list
  sync): met. `SupportedFunctions` gains `coalesce` alphabetically (ExpressionEvaluator.scala:212), arity >= 2 in
  `checkArity` (:226), lazy branch in `evalExpr` (:596-599), `coalesceType` (:508-514). Parity classification extended
  with an explicit `nullFns` exclusion (ExpressionEvaluatorSpec.scala:721-723), so an unclassified future function still
  fails the test. Exact-message assertions updated in all three specs and in the docs Errors example.
- AC2 (red-first): verified genuine. `red-unit.txt` shows 17 failures for the stated reason (`'coalesce' is not a
  recognized function`), the CSV spec's coalesce case red as `Vector(null, null, null)` (parse failure nulls the column)
  while the concat-only pin and `leave null propagation intact` test pass on unmodified code (red-unit.txt:278, 296).
- AC3 (docs + spec): `docs/compute-expression-grammar.md` table row, worked example, null-propagation exception,
  inference rule, analyze-only note, Errors example, limitations; spec delta MODIFIED blocks keep every existing
  scenario of both modified requirements (checked against `openspec/specs/compute-expression-language/spec.md`) and add
  the coalesce requirement. Message text, arity (>= 2), inference rule and parity classification agree across code,
  tests, docs and spec.
- No scope creep (backend engine + analyze + tests + docs only); no API shape change; no frontend change needed
  (no autocomplete/function list exists; repo-wide grep of helio-mcp/frontend/assistant for a compute-function
  enumeration returns no hits besides the files changed).
- Design D5 verified in code: `RunConfigGate.stepConfigReasons` -> `PipelineAnalyzeService.stepConfigProblem` ->
  `validateStepConfig` -> `ComputeStep.companion.validateRawConfig` -> `ExpressionEvaluator.parseProblem` (parse-only,
  schema-blind; ComputeStep.scala:99-104), used by `AutoRunTriggerService` and `PipelineSchedulerService:268`; never
  `inferCompute`. Manual run is not gated (verified live, below).
- `workflow-state.md` CONSTRAINTS is `[]` — nothing to honor beyond Iron Laws.

### Phase 2: Code Review — PASS
Gates (run fresh by me, in WORKTREE_PATH; only `backend/**` + docs/openspec changed, so no frontend gates apply):
- `nice -n 19 sbt -batch -Dsbt.server.autostart=false testFull` from the worktree's `backend/`: both project-path lines
  name this worktree; **6424 tests, 0 failed, 4 canceled, 459 suites, EXIT=0**; the new HEL-1423 tests are in the run.
- `node scripts/check-scala-quality.mjs`: clean (soft size warnings only, informational per CONTRIBUTING.md:236).
- `check-openspec-hygiene.mjs`, `check-spec-structure.mjs`: clean. Prettier on the changed markdown: clean.

Guard/red verification by mutation (scratch `git clone --shared` at d59a65ca, outside the delivery worktree, removed
afterward):
- Run A — M1: coalesce routed through the eager, Left-propagating fold then first-non-null pick; M2: `inferCompute`
  reverted to `.getOrElse(wireType)` (swallowing the Left). Result: exactly 2 failures, one per mutation —
  `should not evaluate arguments after the first non-null one` (M1) and `compute — mixed numeric/text coalesce surfaces a
  validationError` (M2).
- Run B — M3: mixed numeric/text returns `Right("string")`; M4: lazy branch deleted (coalesce falls to `applyFn`).
  Result: 8 failures covering inference, parity, analyze, CSV and evaluate cases.
- Base-commit probe (0a4badcf): `ComputeStep.companion.validateRawConfig` for
  `concat(coalesce($first, ""), " ", coalesce($last, ""))` returns `Some(compute: invalid expression: 'coalesce' is not a
  recognized function; supported functions: abs, ceil, concat, ...)`. This is the exact function the step-save route
  maps to `422` (the same prefix/route the live run below shows for `coalesce($n)` -> 422). The executor did not capture
  main's live save status; this unit probe on the identical code path closes that gap adequately — a live main server
  would add no information beyond the HTTP mapping already observed on this branch.

Code-quality review: small, readable, no dead code, no inline FQNs, no `Any`/casts. `inferCompute` change (D4) only
reaches the new branch for the coalesce error since unknown fields are rejected earlier by `validate`. No issues
requiring change.

### Phase 3: UI Review — N/A
No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**` untouched; only an
`openspec/changes/` delta). The requested live end-to-end re-verification was still done at the API level:
- Servers confirmed as this worktree's: `ss -ltnp` pid 3221958 (java, :9762) cwd
  `.../HEL-1423/backend`, pid 3222236 (node, :6855) cwd `.../HEL-1423/frontend`; `start-servers.sh` reused both,
  `assert-phase.sh servers` PASS. That the backend runs post-change code is corroborated behaviorally (supported list
  includes `coalesce`, analyze emits the new message), not by mtime.
- Throwaway user `hel1423-eval-1791533189@example.test` (id 77917605-...). CSV `first,last,n` with rows
  `Ada,Lovelace,1.5` / `Grace,,2.5` / `,Hopper,`:
  - concat-only -> `Ada Lovelace`, `null`, `null`; coalesce form -> `Ada Lovelace`, `Grace `, ` Hopper`; 3-arg
    `coalesce($last, $first, "anon")` -> `Lovelace`, `Grace`, `Hopper`; same values from `GET /api/outputs/:id/rows`.
    Analyze: no validationError, all three columns `string`, `canRun/autoRunnable: true`.
  - Pipeline 2 (cast `n`->float, then `coalesce($n, "n/a")`): save `201`; `coalesce($n)` save `422` with
    `coalesce requires at least 2 arguments`; analyze returns the step validationError
    `coalesce arguments must all be numbers or all be text; got float, string — wrap a number in concat() ...` plus the
    display-only `step-config-invalid` reason; **manual `POST /run` still executes** (`blocked:false`, rows returned) —
    D5 confirmed live for the manual path.
- Residue deleted by exact id: output 38ae8536-..., pipelines 5147435f-... / 5c4bf057-..., source eab7de72-... (API,
  200/204/204/204), then `pipeline_run_rate_window` rows and the `users` row for id 77917605-f346-4355-a7a9-30f2ec932373
  in one transaction. The executor's user (1003a363-...) is confirmed absent. No HEL-1392/HEL-1284 data touched.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `POST /api/pipelines/:id/validate-expression` still returns `{"valid": true}` for `coalesce($n, "n/a")` over a float
  `n` (observed live) while analyze reports an error. That matches its own spec (`validate`, names only) and it has no
  UI caller today, but its schema description ("the same ExpressionEvaluator.validate the compute step's own
  analyze-time hook uses") is now only half the analyze check. Worth a follow-up note if/when HEL-1403 adds more
  analyze-time type errors.
- Spec/docs say coalesce returns the selected value "unchanged (no coercion)". Accurate relative to the argument's
  evaluated value, but a JSON boolean or object field is already stringified by `FieldRef` evaluation
  (ExpressionEvaluator.scala:582-583), so `coalesce($b1, $b2)` infers `boolean` while emitting `"true"` — the same
  pre-existing gap as a bare `$b`, which design D6 already acknowledges. A one-line clarification would make it exact.
- The spec text "without evaluating any later argument" is not observable (evaluation is pure); the test that guards it
  actually guards "an error in an unreached argument does not fail the row", which is the real behavior. Fine as is.
