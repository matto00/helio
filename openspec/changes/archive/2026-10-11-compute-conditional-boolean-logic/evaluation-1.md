## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `938c31a792712d550867fa4a6d5dfffdf5294959` (branch `feature/compute-conditional-boolean-logic/HEL-1070`).
Diff base: `64e374bb7519262655370bc8c0e210dba930f251`, resolved live via `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- All ACs are met. The conditional construct is `if(cond, then, else)`. Comparison (`= != < <= > >=`, non-associative) and boolean (`and/or/not`, `true/false`, SQL 3VL) operators are added. A conditional count/sum works in one compute step plus an aggregate `sum`; `ComputeConditionalCountSpec` proves this end to end through `InProcessPipelineEngine`.
- The analyze-vs-apply parity spec covers 37 expressions (`ExpressionBooleanInferenceSpec.parityCases`), checked both through `evaluate` and through `ComputeStep.apply`. Precedence is mutation-proven (see Phase 2). The shared fixture gains `if`, `operators` and `literals`, and it is asserted in both directions by the backend, the frontend and helio-mcp. Docs, editor help and the MCP description are all updated.
- Legacy behaviour: the narrow, design-approved deviation set is pinned (`ExpressionBooleanParseSpec`, "legacy bare-identifier expressions"). `LegacyParser` is byte-identical (the diff hunks in `ExpressionParser.scala` stop above line 220, and the frozen class at 226-273 is untouched).
- The owner rulings Q1-Q6 = A (C2) are honoured. There is no case-when, ternary, `&&`/`||`/`!`, null literal or instant compare: `!` alone stays "Unexpected character", and `==`/`<>` are hinted errors.
- Every task in tasks.md is ticked and matches the code. There is no scope creep. The diff never mentions HEL-1491 outside the planning artifacts (C4). No API, schema or Flyway change, which agrees with the design premise check.
- CONSTRAINTS C1-C5: honoured in the diff (C4: no inline FQNs, LegacyParser frozen, HEL-1491 untouched). For C1/C5 evidence exists and I reproduced 3 mutations myself (below). C3 note: red-evidence.md and mutation-evidence.md were recorded with `sbt testOnly` (not `testFull`), so they carry no `[hel1468-guard]` line. Their non-zero test counts show the tests really ran, and my own `testFull` plus guarded mutation runs supersede them. Non-blocking.
- Commit hygiene: the message is `HEL-1070 ...`, ending in the Co-Authored-By trailer only. No `claude.ai` link and no `Claude-Session` trailer (grep count 0).
- `files-modified.md`: one repo path per line, 22 lines, no braces or prose. It matches the non-openspec files in the diff exactly.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (run fresh by me in WORKTREE_PATH):
- `nice -n 19 sbt -J-Xmx3g testFull` (backend): exit 0, `[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 7179, failed 0, canceled 4`. ExpressionBooleanParse/Eval/Inference, ComputeConditionalCount and ComputeExpressionFunctionsSeam all appear in the log. Persisted at `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-testfull-summary.txt`.
- `npm run lint`: exit 0. `npm run format:check`: "All matched files use Prettier code style!". `npm run typecheck` and helio-mcp `npm run typecheck`: clean.
- `npm test`: exit 0. Root jest (incl. helio-mcp) 48 suites / 454 tests; frontend 541 suites / 5881 tests. The two changed frontend test files re-run alone: 19/19 pass.
- `npm --prefix frontend run build`: exit 0.

Mutation spot-check (my own runs, in a throwaway detached worktree at 938c31a79 that I removed afterwards). Command: `nice -n 19 sbt -batch -J-Xmx3g "testOnly com.helio.domain.engine.ExpressionBoolean*"`. Baseline: 66/66 green, guard `failed=0`.
- M1, swap the or/and levels (keyword and node at both levels in `parseOr`/`parseAnd`): `should bind and tighter than or *** FAILED ***`, guard `failed=1`.
- M7, null `if` condition takes then (`!c.contains(false)`): `should pick a branch by the condition (conditional count column) *** FAILED ***`, guard `failed=1`.
- M4, drop the `and` short-circuit (delete the `case Some(false)` arm): `should short-circuit and / or so an erroring right operand is never evaluated *** FAILED ***`, guard `failed=1`.

All three match the executor's mutation-evidence.md. Summaries are persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-mut-{base,m1,m7,m4}-summary.txt`.

Val match-site coverage: the fresh compile in the throwaway worktree (Scala 3 compiler, which warns on non-exhaustive matches) emitted no warning for any `domain/engine/Expression*` file. `VBool` is handled in `instantOf`, `concatStr`, `typeName`, `valToJs`, `FieldRef`, `applyOp` (`+` via `isTextual`) and text functions (via `asText`). Numeric functions and `-` `*` `/` fall into their existing `TypeError` arms, which the "stay a type error where a number is required" test proves.

Checklist:
- Canonical code-quality: no inline FQNs in added Scala; the only hits are `package` lines. Files are within budget: the largest touched source is `ExpressionInterpreter.scala` at 285 lines, under the 400-line split threshold.
- DRY: `commonType` generalises `coalesceType` instead of duplicating it. The frontend `ReferenceList` replaces the inline list. Fine.
- Type safety and error handling: every new run-time failure is a `TypeError` that nulls the row (`ComputeStep.apply` tests prove it never throws). Inference errors flow through `inferCompute`'s existing `Left` arm, which I also confirmed live (below).
- Tests are meaningful: 3VL truth tables are exhaustive (3x3), short-circuit has erroring-right controls, and precedence row values distinguish each parse.
- No dead code, TODO or FIXME. No over-engineering.

### Phase 3: UI Review — PASS
Issues: none blocking.

Servers were started via `start-servers.sh` (6502/9409, `assert-phase.sh servers` PASS) and stopped by exact PID afterwards. I used a throwaway user registered via the API, then deleted it by exact id via `e2e/support` `buildUserDeleteSql` + `psql`; a post-check returned 0 rows for user, pipeline and source.
- Happy path: on a static source (string/integer/boolean), `if($status = "Done", 1, 0)` analyzes as `float`, and `$flag and $points > 2`, typed in through the editor, analyzes as `boolean`. `canRun`/`autoRunnable` are true and Dry run shows "Preview: 3 rows".
- Unhappy path: `$points = "5"` shows the inline validationError "'=' cannot compare float with string; add a cast step to convert the text field to a number" plus the misconfigured-step banner, and `canRun` is false.
- Disclosure: the summary reads "Functions and operators". It is keyboard reachable (focus plus Enter opens it). The `<ul>` lists carry aria-labels "Expression functions" (15 items, incl. `if(cond, then, else)`) and "Expression operators" (11 items: 9 operators and 2 literals).
- Breakpoints 1440 / 1100 / 768 / 375: no horizontal overflow and no clipped items. Screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-ui-operators-{1280,768,375}.png` and `.../hel1070-ui-dryrun.png`.
- Console: no errors from the feature. The only errors were the existing `GET .../schedule` 404 (no schedule set) and a 404 from my own ad-hoc DELETE probe.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css:2117` (`.pipeline-detail-page__compute-functions-signature`): JetBrains Mono's default ligatures render `a != b`, `a <= b` and `a >= b` as "a ≠ b", "a ⩽ b" and "a ⩾ b" in the reference. That is visible in the operators screenshot above. The expression input uses the same font, so typed `!=` looks the same there too. Still, a reference that teaches syntax arguably should show the literal characters: consider `font-variant-ligatures: none` on the signature `<code>`. This is a visual call for the skeptic.
- `ComputeFunctionReference.tsx`: the two lists run on with no visual or heading break between "upper(s)" and "a = b". A small heading or spacing would help. Subjective; deferred to the skeptic.
- `backend/src/test/scala/com/helio/domain/engine/ExpressionBooleanInferenceSpec.scala:100`: a scoped `import com.helio.domain.steps.{ComputeConfig, ComputeStep}` inside a test body. CONTRIBUTING.md "Imports & Qualifiers" prefers top-of-file imports unless widening causes coupling, and `ExpressionBooleanEvalSpec` already imports these at the top. Move it up.
- `helio-mcp/src/tools/computeExpression.ts`: "a boolean column now reads as a boolean" uses time-relative "now", which will read oddly once shipped. Drop "now".
- The ticket's follow-through (collapse the roadmap dashboard's two `%` tiles into real pipeline steps and delete the `static` source) is post-merge operational work, not in this diff. Track it so it is not lost.
- Process: future red/mutation evidence should be recorded with a guard-bearing run (testOnly does print `[hel1468-guard]` under this build, as my runs show), so C3's quoted guard line is present in the evidence files themselves.
