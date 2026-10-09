## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `095f5802cb0f212dce8e9b2c1d2f1263518c7c63`. The diff base was resolved live with `resolve-review-base.sh` (exit 0): `400fca29dba0953329e277f6911d8011bff85c0f`. The branch is one commit on top of that base. origin/main (a796c8e81, HEL-1448) is not an ancestor of the branch. The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=feature/compute-unary-minus-string-warnings/HEL-1403`.

### What I verified (with evidence)

**AST coverage.** `Expr` is `sealed` (`ExpressionParser.scala:15`). I grepped `backend/src/main` for every `BinOp`/`FieldRef(` consumer and found exactly four: `ExpressionInterpreter`, `ExpressionEvaluator.checkRefs`, `ExpressionTypeInference` and the new `ExpressionNumericContexts`. All four handle `Neg`. No lineage or pruning walker exists that could silently skip `Neg`.

**Grammar.** `parseUnary` sits between `parseTerm` and `parseFactor`. Binary `-` in `parseExpr` calls `parseTerm`, which calls `parseUnary`, so `2 - -3` parses as `BinOp('-', 2, Neg(3))`. The tokenizer never produces signed numbers: `-` is always `Token.Minus` (`ExpressionTokenizer.scala:38`). So there is no lexer-vs-parser ambiguity.

**Legacy parser (AC2).** `LegacyParser` is byte-unchanged in the diff.
- Fallback only fires on the `$`-prefix error. `-price` now reaches legacy via that error, and legacy fails with the same "Unexpected token in expression: Minus" message as before. The test pins this, and I confirmed it live: validate-expression returns the `$`-prefix error for `-price`.
- Any expression with no unary minus parses exactly as before. So the spec's "accepted expressions evaluate exactly as before" holds by construction.

**Inference and evaluation parity.**
- Inference: `Neg(e)` gives `float` and propagates an unknown-field `Left`.
- Evaluation: numbers are negated with `+0.0` (no negative zero), `null` stays `null`, and a string is a `TypeError`. This matches binary `-`'s strictness in `applyOp`.

**Gates run fresh (15:57, not cached).** `nice -n 19 sbt -J-Xmx3g testOnly` on ExpressionUnaryMinusSpec, NumericOpOnTextFieldWarningSpec, ComputeExpressionRunSpec, PipelineAnalyzeSchemaWarningsSpec, ExpressionEvaluatorSpec and AnalyzeSchemaWarningsSpec: **214 succeeded, 0 failed, 6 suites completed, 0 aborted**. The embedded-Postgres Flyway migrations logged at 15:57:06 in this run, so the tests actually executed and were not replayed from cache.

**Real pipeline run through the live HTTP stack (AC1/AC3/AC5).** I ran this on this ticket's servers (6835/9742, `assert-phase.sh servers` → PASS) as throwaway user `21d2ffee-a560-47e5-a97b-e370153ac6c9`. Setup:
- A CSV source with columns `name,price,qty`. The source infers every column as `string`.
- A pipeline: cast qty→double, then computes `floor($price)`, `-$qty`, `mod(-7, 3)`, `2 - -3 * -$qty` and `round($qty * 1234, -2)`.

Results:
- **Analyze:** exactly one warning, `numeric-op-on-text-field` on the floor step: "field 'price' is string ... used with floor; ... add a cast step". The cast-to-double `qty` used with unary `-`, `*` and `round` did not warn. Every `validationError` was null and `canRun` was true. The only `costVerdict` reason was the pre-existing `row-estimate-unavailable`; the warning contributed nothing to it.
- **Run (POST /run):** not blocked, 3 rows. Rows for qty = 2 / -4 / 1:

  | Column | Values | Check |
  | --- | --- | --- |
  | `neg` | -2 / 4 / -1 | correct |
  | `m` | 2 / 2 / 2 | correct |
  | `d` | -4 / 14 / -1 | correct for `2 - ((-3) * (-qty))` |
  | `r` | 2500 / -4900 / 1200 | correct |
  | `f` | null on every row | the warned compute still runs and nulls |

- **Persistence:** `GET /api/outputs/<id>/rows` returned the same values from `node_snapshots` (`materialized: true`).
- **Validation endpoint:**
  - `mod(-7, 3)`, `-$qty * 2` and `--$qty` are valid.
  - `$qty * -` is rejected with "Unexpected end of expression".
  - `+5` is rejected with "Unexpected token ... Plus".

**The warning cannot block (AC5), checked structurally.**
- `PipelineService.scala:1010/1149/1471`: `AnalyzeSchemaWarnings.compute` runs after `analyzeNodes`. Its result goes only into `warnings` / concise `warnings`. It never feeds the projections, `toCostVerdictResponse` or `validationError`.
- `RunConfigGate.scala:10-11` reads only kind and raw config through `stepConfigProblem`, never a schema or the warnings.
- The new check is reached only for enabled steps without a `validationError` (`AnalyzeSchemaWarnings.scala:131`). It is gated on `in.types`.

**Trust gating and false negatives.**
- The gate reuses the join-key type-trust flags: the root is trusted, and only `typeTrusted` ops and trusted casts preserve trust. An upstream compute, fillnull, aggregate or untrusted cast suppresses the warning. That is a deliberate false-negative-over-false-positive trade-off, recorded in design.md:120.
- The `+`-inference false negative is real but consistent with the spec: `floor($b + 1)` with a boolean or `string-body` operand infers `float` and stays silent. The spec wording ("within a sub-expression whose inferred type is not numeric") defines the check by inferred type, so this is not a divergence.
- C1: the "upstream compute as TEXT" fixture asserts the projected type is `string` before asserting there is no warning, so the gate is the sole reason the assertion holds. The evaluator's mutation runs are pasted with per-mutation discrimination rationale. I did not re-run the mutations: the fixture logic satisfies C1 on inspection, and my own live probe exercised the trusted-cast negative case.

**Spark (AC4).** `SparkJobSubmitter.scala:246` is `F.expr(s.config.expression)`, a pass-through with no code change. The doc's statement holds for Spark SQL: unary minus binds tighter than `*`/`/`, `--` starts a line comment, and `$`-reference expressions already diverge on that path.

**Contract sync (AC6).**
- Updated surfaces: both schema enums, `PipelineAnalyzeProtocol` doc, frontend `AnalyzeWarningCode`, helio-mcp `AnalyzeWarning.code`, both tool descriptions and the `server.test.ts` pin.
- A repo grep for `join-column-renamed` turns up no other enumeration site that was left out.
- Checks I ran fresh, all exit 0:
  - `npm run check:helio-mcp-types`, `check:schemas`, `check:openspec`
  - `npx jest helio-mcp/src/server.test.ts`: 26/26 passed
  - frontend `tsc --noEmit`
- HEL-1448: main-checkout `npx eslint --no-ignore --max-warnings=0` (main at a796c8e81) on all 5 changed TS files exits 0.

**Grammar doc (AC1).**
- `docs/compute-expression-grammar.md` has a new "Unary minus" section covering binding against `*`/`/`, function calls, groups, repeated `--` and no unary plus. It matches the parser and my live results.
- The "no unary minus" known limitation is removed, `0 - x` workarounds are rewritten, the inference list includes unary `-`, and there is a new paragraph on the analyze warning.

**UI (step 4): N/A.** The only `frontend/**` change is one type-union member. Nothing in `frontend/src` renders, branches on or reads `AnalyzeWarning`/`AnalyzeWarningCode`; grep finds only `pipelineStep.ts`. There is no client-side expression parser, because live validation goes through the backend `validate-expression` endpoint, which I probed above. There was no changed view to screenshot.

### Verdict: CONFIRM

### Non-blocking notes
- The grammar doc says the warning fires "only when the input schema's types are trusted". It does not name the `+`-inference false negative (`floor($b + 1)` / `floor($sb + 1)`) or the per-step trust coarseness (CSV → compute(other column) → `floor($price)` stays silent). Mention both in the PR body as follow-up candidates.
- Dev-DB residue: I created user `21d2ffee-a560-47e5-a97b-e370153ac6c9` (email `skeptic-hel1403-1791586664@example.test`). I deleted pipeline `fa6972a6-afc4-41b8-bce4-885a67d88125` and data source `7964d919-4ed1-4f41-87f7-be66f0774472` by exact id (204 each). The user row remains because no account-delete API exists. It is recorded here for exact-id cleanup.
- The warning message joins unary and binary `-` into a single "-" context. That is harmless, but it is slightly less specific than it could be.
