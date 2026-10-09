## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d59a65ca0e317531e318bb2c7a4d6726f89579f8` (working tree clean apart from the untracked `evaluation-1.md`).
Base resolved live: `resolve-review-base.sh` → `0a4badcfb33d76ee02ca4be503fae761f1ed9f82` (exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/compute-expression-coalesce-function/HEL-1423`.
- **Diff read in full** (`git diff 0a4badcf...HEAD`): 2 main-source files (+29/-? `ExpressionEvaluator.scala`, +9 `PipelineAnalyzeService.scala`), 4 test files, docs, change artifacts. No frontend change.
- **AC1, coalesce semantics and type inference:**
  - `ExpressionEvaluator.scala:212`, `coalesce` added to `SupportedFunctions` in alphabetical order (this is the shared list that drives the unknown-function message, per HEL-1315).
  - `checkArity` requires `argc >= 2`.
  - `evalExpr` handles `Call("coalesce", ...)` before the eager fold. It uses `iterator.map(...).collectFirst`, so evaluation is lazy and short-circuits, and it never reaches `applyFn`'s null guard.
  - `coalesceType` returns: all-same → that type; all numeric → `float`; no numeric → `string`; numeric/text mix → `Left`, which is the owner ruling `analyze-error` (events.jsonl `escalation.answered`, answer `analyze-error`, `answer_source: human`).
  - `PipelineAnalyzeService.inferCompute` now surfaces that `Left` as `validationError` and keeps the wire-type fallback column.
  - I checked that only the new error can reach this branch. `validate` rejects unknown fields first. `SchemaField` requires canonical types, so a legacy `"number"` type cannot cause a false mixed-type error.
- **Parity and list guards (HEL-1315 pattern):**
  - The numeric parity classification now carries `coalesce` as an explicit third class.
  - The list size went 10 → 11, and the exact-message assertions are updated in all three specs.
  - A new coalesce infer↔evaluate JSON-class parity test was added.
  - I grepped frontend/helio-mcp/backend resources for any other compute-function enumeration or prompt and found none (zero hits beyond `ExpressionEvaluator.scala` and the grammar doc).
- **AC2 (red first): the red is real.**
  - `evidence/red-unit.txt` shows 17 failures, all for the reason `'coalesce' is not a recognized function`, including the CSV spec's coalesce case. The concat-only null pin passes on unmodified code.
  - Structurally the red is certain: on base, `checkArity` has no `coalesce` case and falls into the unknown-function `Left`.
  - The evaluator's base-commit probe (`eval-c1/baseProbe.txt`) shows the save path on base returns `'coalesce' is not a recognized function`.
  - The mutation runs (`mutA`/`mutB`) show that the lazy-eval test and the analyze-surfacing test each kill their own mutant.
- **Pipeline-level test over the real loader:**
  - `ComputeCoalesceCsvSpec` uses `CsvLoadSupport`. I read it: it calls the production `InProcessPipelineEngine.loadRows` on a real temp CSV.
  - It asserts `concat($first," ",$last)` → `["Ada Lovelace", null, null]` and the coalesce form → `["Ada Lovelace","Grace "," Hopper"]`.
- **Fresh full suite (my own run):**
  - Command: `nice -n 19 sbt -batch -Dsbt.server.autostart=false testFull` from the worktree's `backend/`. Both project-path lines name the HEL-1423 worktree.
  - Result: `Total number of tests run: 6424 / Suites: completed 459, aborted 0 / Tests: succeeded 6424, failed 0, canceled 4 / All tests passed. / exit=0`.
  - All new `coalesce` tests appear as executed in the output.
- **Live, on this worktree's own servers:**
  - `ss -ltnp` shows `:9762` java pid 3221958 with cwd `.../HEL-1423/backend` and `:6855` node pid 3222236 with cwd `.../HEL-1423/frontend` (`readlink /proc/<pid>/cwd`). `assert-phase.sh servers` → `PASS servers`.
  - Behavior confirms the post-change code is loaded: `coalesce` is accepted and the new message is emitted. I am not relying on mtime for this.
  - Throwaway user `hel1423-skeptic-1791534030@example.test` (id `9de03790-...`). CSV `first,last,a,b` with blank cells; pipeline `cast(a:integer,b:float) → concat-only → coalesce-concat → coalesce($a,$b,0)*2 → upper(coalesce($last, coalesce($first,"?")))`.
  - Run and `/api/outputs/:id/rows` (materialized):
    - `raw` = `"Ada Lovelace", null, null`
    - `full` = `"Ada Lovelace", "Grace ", " Hopper"`
    - nested coalesce = `LOVELACE, GRACE, HOPPER`
    - `coalesce($a,$b,0)*2` = `2.0, null, 0.0` (see the cast note below)
  - Analyze: no `validationError` on any of those steps, `autoRunnable/canRun=true`.
  - Added `coalesce($a, "none")` (a is integer). Save returned 2xx. Analyze → `"coalesce arguments must all be numbers or all be text; got integer, string — wrap a number in concat() to coalesce it as text"`.
- **UI rendering of the analyze error** (no frontend diff, but the user-visible effect is checked; dark theme):
  - The message renders inline under the EXPRESSION input in the existing error style, and the step header shows the warning icon.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/.playwright-mcp/hel1423-skeptic-mixed-error-dark.png`, `/home/matt/Development/helio/.concertino/runs/HEL-1423/evidence/.playwright-mcp/hel1423-skeptic-pipeline.png`.
  - Console: only the pre-existing `/schedule` 404 for a pipeline with no schedule.
  - I did not do a light-theme comparison because no styling code changed.
- **Residue:**
  - Deleted output `2845cbd0-…` (200), pipeline `bea47897-…` (204), source `967236d7-…` (204).
  - Deleted user `9de03790-5b13-4db4-96a5-246b3be3a23f` by exact id+email, after first deleting its `pipeline_run_rate_window` row (a non-cascading FK). Post-check counts are 0 users/pipelines/sources.
  - No `hel1423-%` users remain. I did not touch other lanes' data or `matt@helio.dev`.
- **AC3, docs and spec:**
  - `docs/compute-expression-grammar.md`: table row, CSV-blank worked example, null-propagation exception, common-type inference rule plus the analyze-only note, updated Errors example, HEL-1070 pointer.
  - Spec delta: MODIFIED requirements keep every base scenario (compared header by header against `openspec/specs/compute-expression-language/spec.md`), plus an ADDED coalesce requirement.
  - `openspec validate compute-expression-coalesce --strict` → valid.
- **D5 claim (runs are not blocked) checked in code:**
  - `RunConfigGate.stepConfigReasons` → `PipelineAnalyzeService.stepConfigProblem` → `validateStepConfig` only. The schema-dependent path does not reach the gate.
  - `AutoRunTriggerService:107` and `PipelineSchedulerService:268` both route through it.

### Verdict: CONFIRM

### Non-blocking notes

- **Pre-existing bug, outside this ticket (recommend a follow-up):** `CastStep.castValue` (`backend/src/main/scala/com/helio/domain/steps/CastStep.scala:69-80`) has no case for the canonical `"float"` (or `"timestamp"`). A cast to `float` falls through to `case _ => str` and leaves the value a string, while analyze reports `float`.
  - Live: `b` cast to float came back `"7"`. So `coalesce($a,$b,0)*2` was `null` for that row: coalesce correctly returned `"7"`, and `*` then failed with a TypeError.
  - The evaluator's run shows the same thing (`n:"1.5"` after `cast n->float`).
  - This undercuts the doc's numeric-coalesce story in practice, but it is not caused or changed by HEL-1423.
- **Pre-existing UI wording:** when the mixed-type analyze error is present, the pipeline footer shows "A step in this pipeline is misconfigured, so it can't run until that step is fixed". The Run pipeline button is still enabled, and server-side runs still fire. The design (D5) and the docs call this display-only, same as an existing `Unknown field` error. The wording overstates the block, but it predates this change.
- `validate-expression` returns `{"valid":true}` for a mixed-type coalesce (parse-only), so the error appears only after analyze. This is consistent with the design; mentioned for completeness.
