## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `095f5802cb0f212dce8e9b2c1d2f1263518c7c63`. The diff base was resolved live with
`resolve-review-base.sh`: `400fca29dba0953329e277f6911d8011bff85c0f`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (unary minus): `Neg` AST node plus a `unary` level in `StrictParser` (`ExpressionParser.scala:65-80`). Inference returns `float` and propagates the operand's `Left` (`ExpressionTypeInference.scala:24-25`). Evaluation is strict, null propagates, and it never produces negative zero (`ExpressionInterpreter.scala:38-43`). Every example in the ticket is covered by `ExpressionUnaryMinusSpec`. That includes `-5`, `-$x`, `mod(-7, 3)`, `2 - -3`, `2--3`, `--$x`, `-floor($x)`, `round($x, -2)` and `-(1+2)`, plus binding against `*` (AST equality with `(-$a) * $b`) and a `-e` ≡ `0 - e` parity table. The grammar doc has a new "Unary minus" section, the "No unary minus" limitation is removed, and the `0 - x` workarounds are rewritten.
- AC2 (legacy parser): unchanged and frozen. The doc says so in the "Unary minus" section, and `ExpressionUnaryMinusSpec` "the frozen legacy parser (D3)" pins the run path (`evaluate` / `parseProblem` message unchanged). Per skeptic r2 note 3, the test does not assert the old strict-`validate` message.
- AC3 (red-first, unit and real run): the unit tests are in `ExpressionUnaryMinusSpec`. The real-run test is `ComputeExpressionRunSpec`: `PipelineRunService.submit` against embedded Postgres, with persisted `node_snapshots` rows asserted. Red-first is plausible: before the change, every positive unary case fails to parse ("Unexpected token in expression: Minus"). I also confirmed both specs discriminate by mutation (see Phase 2).
- AC4 (Spark): documented in the Known-limitations Spark note (`--` starts a SQL comment; `$` references already diverge). No code change, as design D4 says.
- AC5 (non-blocking warning): `AnalyzeSchemaWarnings.scala:146-148` and `:200-211`. It is reached only from the existing `warnings` pass, which is already filtered to enabled steps with no `validationError` (`:131`). It is gated on `in.types`. `PipelineAnalyzeSchemaWarningsSpec` asserts `costVerdict.canRun == true`, no `validationError`, no `StepConfigInvalidCode` reason, the warning present on the full, concise and proposal responses, and JSON-schema validity of both responses. "Warned compute still runs" is asserted by `ComputeExpressionRunSpec`: the run is a `Right` and every row's value is `null`.
- AC6 (contract sync): both schema enums, `PipelineAnalyzeProtocol` doc, frontend `AnalyzeWarningCode`, helio-mcp `AnalyzeWarning.code`, both tool descriptions and the `server.test.ts` pin. Spec deltas: an ADDED requirement for unary minus, a MODIFIED requirement for the numeric functions (I diffed it against the main spec: only the two `0 - x` scenario lines change), a MODIFIED code list and an ADDED warning requirement. `openspec validate --strict` passes.
- Tasks: all checked, and they match the implementation. One minor placement deviation is listed under suggestions.
- Scope: no creep. The only non-code edits are the change dir, the docs and the contract surfaces listed above.
- CONSTRAINTS: C1 is honored. I verified it independently by mutation; see Phase 2.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates I ran myself in `WORKTREE_PATH` at 095f5802c:**
- `nice -n 19 sbt -J-Xmx3g testFull`: exit 0, **6478 succeeded, 0 failed**, 4 canceled (pre-existing). These specs ran: `ExpressionUnaryMinusSpec`, `NumericOpOnTextFieldWarningSpec`, `ComputeExpressionRunSpec`, `PipelineAnalyzeSchemaWarningsSpec`, `AnalyzeSchemaWarningsSpec`, `ExpressionEvaluatorSpec`. No scalac exhaustivity or match warning mentions the expression or warning files.
- `npm run lint`: 0. `npm run format:check`: 0. `npm run typecheck`: 0. `npm test`: 0 (root 44 suites / 426 tests, including `helio-mcp/src/server.test.ts`; frontend 497 suites / 5196 tests). `npm --prefix frontend run build`: 0. `helio-mcp npm run typecheck`: 0.
- Pre-commit checks: `check:repo-integrity`, `check:helio-mcp-types`, `check:schemas`, `check:spec-structure`, `check:openspec`, `check:scala-quality`, `check:test-temp-dir-hygiene` and `check:no-credential-leak` all exit 0.

**C1 mutation checks (I re-ran them; I did not trust the executor's claim).** I ran them in a throwaway detached worktree at 095f5802c and removed it afterwards (`git worktree list` shows no straggler).
1. Trust gate dropped (`if (step.op == "compute" && in.types)` changed to `if (step.op == "compute")`). `NumericOpOnTextFieldWarningSpec` goes RED in exactly two tests: "not warn when the field was produced by an upstream compute as TEXT (untrusted types)" and "not warn for an unrelated column after a compute". Result: 10 passed, 2 failed.
   - Why the fixture discriminates: `x = $s` projects `x` as `string`, and the test asserts that projection. With the gate removed, `floor($x)` would warn, so the gate is the only reason the assertion holds.
2. `boolean` dropped from `TextTypes` (`ExpressionNumericContexts.scala:13`). Only "warn for a boolean field under unary minus" goes RED. Result: 11 passed, 1 failed.
   - Why the fixture discriminates: `b` is `boolean` at a trusted root, so membership in the text set is the only path to a warning.
3. Extra check of my own: unary negation removed in the interpreter (`VNum(-n + 0.0)` changed to `VNum(n + 0.0)`). `ComputeExpressionRunSpec` "persist unary-minus results in node_snapshots" goes RED, along with 8 `ExpressionUnaryMinusSpec` tests. Result: 9 passed, 9 failed. So the real-run test does catch a regression.

**Compatibility with main's HEL-1448 typescript-eslint rules.** No changes to main's eslint config are needed.
- I ran main-checkout `npx eslint --no-ignore --max-warnings=0` (main at a796c8e81, with `@typescript-eslint/recommended`) on all 5 changed TS files in the worktree: exit 0.
- I proved the check is live: a probe `const x: any` at a worktree path under the same config fails with `@typescript-eslint/no-explicit-any`, and `--print-config` shows 21 `@typescript-eslint/` rules applied.
- `scripts/check-eslint-ts-rules.mjs`: OK.
- `git merge-tree --write-tree HEAD origin/main`: no conflicts, and no file overlap with main's newer commits.

**Review checklist:**
- AST coverage: every pattern match on the sealed `Expr` handles `Neg`. The sites are `ExpressionEvaluator.checkRefs:162`, `ExpressionTypeInference.inferTypeOf:25`, `ExpressionInterpreter.evalExpr:38` and the new `ExpressionNumericContexts`. These four files are the only importers of `ExpressionParser`.
- CONTRIBUTING: no inline FQNs, and the new file is small (55 lines). The test harness follows existing specs (`registry = null`, `LocalFileSystem(Paths.get("/"))` and the `stringtype` connect config also appear in `PipelineRunServiceOutputHistorySpec`, `OutputHistoryApiHarness` and others).
- Type safety, error handling: the config decode is wrapped in `Try`, and a legacy or unparseable expression yields no warnings. `types(field)` in the message is safe because `textRefs` only returns fields that are present in `fieldTypes`.
- No dead code or TODOs. Not over-engineered: one pure helper behind the facade.

### Phase 3: UI Review — N/A
The trigger `frontend/**` matches, but the only frontend change is one member added to the `AnalyzeWarningCode` type union (`pipelineStep.ts:632`). Nothing in `frontend/src` renders, branches on or reads `AnalyzeWarning`/`AnalyzeWarningCode` beyond the type declarations (grep finds only `pipelineStep.ts:625-647`). There is no client-side expression tokenizer or validator, so unary-minus acceptance is purely server-side. No `ApiRoutes.scala`, `schemas/**` route shape or `openspec/specs/**` change affects a rendered surface. Frontend typecheck, lint, tests and production build all pass. The wire format is covered by the JSON-schema validation in `PipelineAnalyzeSchemaWarningsSpec`. So there is no observable UI flow to exercise, and I did not start any servers.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- Known false negative from skeptic r2 note 2: `floor($b + 1)` (boolean) and `floor($sb + 1)` (`string-body`). `+` infers `float` unless an operand is literally `string`, so these stay silent while still nulling every row. Name it in the PR body as a follow-up candidate. The doc currently describes coverage only as "only when the input schema's types are trusted".
- tasks.md 1.1 names `ExpressionEvaluatorSpec` as the home for the unary-minus tests. The executor put them in a new `ExpressionUnaryMinusSpec.scala`, which is reasonable for file-size budgets. Consider noting this in tasks.md at archive time.
- `parseUnary` recurses once per `-`, so a pathologically long `----…` chain could overflow the stack. This is the same exposure parenthesised groups already have before this change, and it is not new in kind.
