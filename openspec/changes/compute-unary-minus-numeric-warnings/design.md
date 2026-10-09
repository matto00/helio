## Context

See proposal.md — Why. Current state on origin/main (400fca29d, after HEL-1404's split):

- `ExpressionTokenizer` already emits `Token.Minus` for every `-`; no number literal carries a sign.
- `ExpressionParser.StrictParser`: `expr → term (('+'|'-') term)*`, `term → factor (('*'|'/') factor)*`,
  `factor → Num | Str | Ref | FnName '(' args ')' | '(' expr ')'`. A leading `-` hits `factor`'s
  `case other => Left("Unexpected token in expression: Minus")`.
- `ExpressionParser.LegacyParser` is a FROZEN verbatim copy ("Do not add new syntax here"), reached only from
  `evaluate()`/`validateTolerant()` when strict parsing fails with exactly the `$`-prefix message.
- AST: `NumLit | StrLit | FieldRef | BinOp | Call`. Consumers that pattern-match it: `ExpressionTypeInference.inferTypeOf`,
  `ExpressionInterpreter.evalExpr`, and anything in `ExpressionEvaluator` that walks the tree (executor to grep
  for every `case BinOp` / `case Call` match in `domain/engine` and cover the new node in each — a missed match is a
  `MatchError` at run time, so add the node with the compiler's exhaustivity check as the gate).
- Analyze: `ColumnSchemaInference.inferCompute` validates with `ExpressionEvaluator.validate` and types with
  `ExpressionEvaluator.inferType` (a `Left` there is HEL-1423's blocking coalesce error). Non-blocking warnings are
  `AnalyzeSchemaWarnings.compute(steps, projections, secondarySchemas)` — a separate pure pass over projections,
  with `Flags(names, types)` completeness tracking; nothing reads its output for `validationError`, `costVerdict`
  or `stepConfigProblem`. It is wired into the full, concise (per-node) and proposal analyze responses in
  `PipelineService` (three call sites). So the warning plumbing the driver asked about EXISTS and supports
  non-error findings — no new severity is invented.
- CSV roots project every column as `string` (HEL-893 D1, `SchemaInferenceEngine.fromCsvLines`), and the root
  projection is type-trusted (`Flags(nonEmpty, nonEmpty)`). Run time: `JsString` → `VStr`, `JsBoolean` → `VStr`,
  so `-`/`*`/`/` and numeric functions on either are per-row `TypeError` → `null`.

## Goals / Non-Goals

**Goals:** unary minus in the strict grammar with inference/evaluation parity; a non-blocking compute warning for
numeric use of a trusted text/boolean field; contract surfaces in sync.

**Non-Goals:** changing the legacy parser; changing `+` coercion; warning on string functions given numbers
(`length($n)`), on string-literal operands (`"3" * 2`), or on `substring`'s numeric arguments (follow-up
candidates); fixing the Spark grammar divergence; HEL-1436 (cast float/timestamp fall-through); HEL-1070.

## Decisions

### D1 — New AST node `Neg(e: Expr)`, parsed at a new `unary` level

`term → unary (('*'|'/') unary)*`; `unary → '-' unary | factor`. Function-call arguments and parenthesised
groups go through `parseExpr` as today, so `mod(-7, 3)` and `(-$x)` work with no extra rule.
Consequences, documented in the grammar doc: unary `-` binds tighter than `*`/`/` and applies to the single
following factor (`-$a * $b` = `(-$a) * $b`, `-floor($x)` = `-(floor($x))`, `-$a + $b` = `(-$a) + $b`);
repeated minus is accepted and cancels (`--$x` = `$x`, `2 - -3` = `2--3` = `5`). There is no `^`/power operator, so
the classic `-2^2` ambiguity cannot arise. Unary plus stays unsupported (`+5` remains a parse error) — it adds
nothing and was not asked for.

Alternatives: (a) fold `-` into the number token in the tokenizer — rejected: the tokenizer cannot tell binary
from unary (`2-3` vs `2 - -3`) without parser context, and it would not cover `-$x`/`-floor(...)`.
(b) rewrite `-e` to `BinOp('-', NumLit(0), e)` — rejected: error messages and `toString` would show a phantom
`0`, and `0 - e`'s semantics are identical anyway, so a dedicated node is clearer at the same cost.
(c) reject `--x` — rejected: it is mathematically unambiguous in this grammar, and `2 - -3` must work; rejecting
only the adjacent `--` would require whitespace-aware tokenizing for no correctness gain in the in-process engine.

### D2 — Type inference and evaluation parity

`inferTypeOf(Neg(e))`: infer `e` (propagating its `Left`, e.g. unknown field / coalesce error), result `float`
— the same rule binary `-` uses (binary `-` returns `float` regardless of operand types). Evaluation:
`VNum(n)` → `VNum(-n + 0.0)` (no negative zero, matching `numericUnary`), `VNull` → `VNull`, `VStr` → `TypeError`
("Operator '-' cannot be applied to string", unary wording). Parity is tested by asserting `-e` ≡ `0 - e` over a
table of numeric/null inputs, and `-$s` on a string nulls the row.

### D3 — Legacy parser unchanged (stated)

The legacy parser does not get unary minus (it is frozen by design.md Decision 4 of
`compute-step-expression-rework`). Effect: a legacy bare-identifier expression containing a unary minus
(`-price`) fails exactly as before (strict fails with the `$`-prefix error → legacy retry → legacy parse error →
row value `null` / validation message). A strict expression with unary minus never reaches the legacy parser.
A test pins this.

### D4 — Spark path: documented difference, no code change

`SparkJobSubmitter` passes the stored expression to `F.expr` unchanged. Spark SQL has native unary minus with the
same precedence, but `--` begins a SQL line comment, so `2--3` / `--$x` would differ; and Spark SQL does not
understand `$` column references at all, so every strict expression already diverges there (existing
Known-limitations note). The grammar doc's Spark note is extended to mention `--`; no Spark code change.

### D5 — Warning code `numeric-op-on-text-field` in `AnalyzeSchemaWarnings`

A pure helper in the expression layer, exposed via the `ExpressionEvaluator` facade (e.g.
`numericContextTextFields(expression, fieldTypes): Vector[(field, context)]`), walks the strictly-parsed AST:
for each numeric context — every argument of `floor`/`ceil`/`round`/`mod`/`abs` (`NumericFunctions`), both
operands of `-`/`*`/`/`, the operand of `Neg` — it infers the operand's type with the existing
`inferTypeOf`; if the operand is not numeric (`integer`/`float`), it collects the operand's `FieldRef`s whose
projected type is `string`/`string-body`/`boolean`. (So `floor($s + 1)` warns on `s`, `floor(coalesce($s, "0"))`
warns on `s`, `floor($n)` with `n` integer does not, and `$s + 1` does not because `+` is not a numeric context.)
Results are deduped per field, keeping every distinct context for the message.

`AnalyzeSchemaWarnings.compute` adds, for `step.op == "compute"` with `step.enabled`, no `validationError`, and
`inputFlags(step, a).types == true`: decode `expression` (Try; undecodable → nothing), call the helper with
`a.inputSchema` types, emit one `Warning(step.id, "numeric-op-on-text-field", msg)` per field. Message shape:
`compute: field 'price' is string in this step's inferred input schema but is used with floor, -; every non-null row will compute null at run time — add a cast step before this step to convert it to a number`
(evidence base stated, per HEL-1235's stale-schema rule). Ordering uses the existing sort.

Why require `types` trust: projected types after `compute`/`fillnull`/`aggregate`/an untrusted `cast` may not
match run-time classes (HEL-1235's own reasoning). Requiring trust means no false positive from a stale or
informational type; the cost is missed warnings after such steps (accepted, as for join-key mismatch).
Boolean is included because `JsBoolean` evaluates as `VStr` — the identical every-row-null failure — and HEL-1235's
`family` already pins `boolean` as run-time-trusted. `timestamp`/`date` are excluded (run-time class not pinned).

HEL-1436 interaction: a `cast` to `float`/`timestamp` is untrusted (`castRuntimeTargets` excludes them), so a
compute after such a cast gets no warning even though the value is still a string at run time — the warning is
silent there, never wrong. Fixing the cast is HEL-1436's job; once it lands, the trust set widens and this warning
covers that case automatically. Noted in the PR, not absorbed.

Alternative: emit from `ColumnSchemaInference.inferCompute` — rejected: that path produces the blocking
`validationError` and has no access to type-trust flags; warnings live in their own pass by HEL-1235's design.

### D6 — Contract sync

Add the code to both analyze response schemas' `code` enum, the frontend `AnalyzeWarningCode` union, helio-mcp's
`AnalyzeWarning.code` union, the helio-mcp `analyze_pipeline`/`analyze_pipeline_proposal` descriptions (read.ts,
pipelineProposal.ts) and the `PipelineAnalyzeProtocol` doc comment. A test asserts a real analyze response with
the new code validates against the JSON schema (reuse the existing HEL-1235 schema-validation test pattern).

## Risks / Trade-offs

- [A missed AST pattern match causes a run-time `MatchError`] → compiler exhaustivity on the sealed trait;
  `-Xfatal-warnings`/scalac warnings checked; a grep for `case BinOp(` in `domain/engine` in the evaluator review.
- [`--` diverges on Spark] → documented; Spark already cannot run `$` expressions.
- [False-negative warnings after untrusted steps] → accepted. Trust is tracked per step, not per column, so even CSV → compute(other column) → `floor($price)` stays silent (pinned by a test; per-column trust is a follow-up candidate).
- [False positives] → minimised, not eliminated: the warning relies on the root projection being trusted (the same assumption HEL-1235's join-key check makes); a stale stored root schema could still warn wrongly, which is why the message states its evidence base.
- [Main spec Purpose of `pipeline-analyze-schema-warnings` lists only the HEL-1235 shapes] → a delta cannot change Purpose; the orchestrator updates that one sentence at archive time (Delivery) to mention numeric use of a text field.
- [Existing callers that relied on a leading `-` being a validation error] → none known; red-first tests prove
  every previously-valid expression still evaluates identically (existing ExpressionEvaluatorSpec stays green).
