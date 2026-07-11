## Context

`ExpressionEvaluator.scala` is a hand-rolled recursive-descent parser (tokenize → AST → eval)
already supporting numeric/string literals, bare-identifier field refs, `+ - * /`, and parens.
`ComputeStep.apply` calls `evaluate` per row, mapping failures to `null`. `inferCompute` derives
the output schema from `config.type`, hardcoded to `"number"` by the frontend and never inferred
from the expression. `ComputeFieldConfig.tsx` doesn't read/render `validationError` even though
`analyze` already computes one per step. `pipeline_steps.config` is `TEXT`, not JSONB — the
`expression` string is opaque to SQL; only the Scala tokenizer can tell an identifier from a
string literal within it. All four open design questions are locked per the human's decision
(proposal.md "Recommendation").

`ExpressionEvaluator` is also consumed outside the Compute pipeline step: `DataTypeService`
(`validateExpression`, `applyUpdate`'s `exprError` check) and `SourceService`
(`applyComputedFields`) validate/evaluate `data_types.computed_fields[].expression` — a separate
live feature with its own frontend (`ComputedFieldForm.tsx`), untouched by this ticket. Critically,
`DataTypeService.applyUpdate` **hard-blocks** the whole `PATCH /api/types/:id` if *any* entry in
the incoming `computedFields` array fails `validate` — including untouched entries, since the
frontend resubmits the full list on every save. The Compute pipeline step's own save path never
gates on `validate()` (`analyze` only computes an informational `validationError`). This asymmetry
drives Decision 4 below.

## Goals / Non-Goals

**Goals:**
- `$`-required column refs; bare identifiers are a parse error under the new grammar.
- Function-call syntax: `concat`, `substring`, `lower`, `upper`, `length`.
- Strict numeric ops / permissive `+` (string coercion), matching today's `applyOp` semantics.
- Inline `validationError` rendering in `ComputeFieldConfig`.
- Existing persisted compute steps continue to work with zero manual user action.
- One grammar doc (`docs/compute-expression-grammar.md`) referenced by both engine and UI.

**Non-Goals:**
- Autocomplete (ticket's stated stretch goal).
- Boolean/comparison operators, conditionals, aggregate functions in compute expressions.
- Rewriting persisted expressions in the database (Decision 4 — no migration needed; resolved via
  a validate/evaluate split instead).
- Tightening `DataTypeService`'s computed-field validation to `$`-required (Decision 4 — deferred
  as a follow-up, not silently broken or expanded in this ticket).

## Decisions

**1. Tokenizer: `$` sigil on identifiers, function-call parsing.**
Add a `Token.Dollar` case; `$` immediately followed by an identifier tokenizes to `Token.Ref(name)`
(was `Token.Ident`, reused for column refs only). Bare identifiers followed by `(` tokenize as
`Token.FnName(name)` and open a call-argument list; bare identifiers not followed by `(` are
rejected at parse time (`Left("Column references require a '$' prefix")`).

**2. AST: add `Call(name, args: Vector[Expr])`, keep `BinOp` unchanged.**
`parseFactor` gains a branch: `Token.FnName(name) → parseArgs → Call(name, args)`. Precedence is
untouched — functions bind like `factor`, so `concat($a,$b) + 1` parses unambiguously.

**3. Function semantics — implemented in `evalExpr`, not `applyOp`.**
- `concat(...)`: variadic, coerces every arg to string (reuses `numStr` for numbers), same
  coercion table as `+`. Arity ≥ 1.
- `substring($s, start, end)`: arity 3 (end exclusive, 0-indexed); out-of-range clamps rather
  than throwing, matching the "bad expr → null-safe" philosophy but only for *range*, not *type*
  — a non-string arg 1 is still a `TypeError`.
- `lower` / `upper` / `length`: arity 1, string-typed input (`TypeError` otherwise); `length`
  returns `VNum`.
Each is a case in a new `applyFn(name, args): Either[EvaluationError, Val]`, called from
`evalExpr`'s `Call` branch — keeps `applyOp` (binary operators) and `applyFn` (functions)
separate for readability, per CONTRIBUTING's small-composable-units guidance.

**4. Back-compat for existing persisted expressions: split `validate()` (strict) from `evaluate()`
(legacy-tolerant execution), not a data migration (REJECTED: Flyway SQL migration; REJECTED:
permanent fallback inside the shared `parse()` used by both).**
`pipeline_steps.config` is `TEXT`, not `JSONB` (`V23__pipeline_steps.sql`) — the `expression`
string is opaque to SQL and only the tokenizer can disambiguate identifiers from quoted string
literals inside it, so a SQL `regexp_replace` migration risks corrupting data and is ruled out. A
first draft wired the legacy fallback into the shared `parse()` used by both `validate()` and
`evaluate()` — **rejected**: `parse()` can't distinguish "user just typed this" from "persisted
before the grammar changed," so the fallback would silently accept bare identifiers for brand-new
input too, permanently defeating decision #1 for the case it exists to serve.
**Chosen approach:** keep `parse()` strict-only (`$`-required, function-call syntax) — the only
parser `validate()` calls, so anyone asking "is this well-formed under the new grammar" (live UI
feedback, `inferCompute`) always enforces decision #1. Add the legacy fallback **only** inside
`evaluate()`: if strict `parse()` fails with the specific `"Column references require a '$'
prefix"` error, `evaluate()` retries via a frozen verbatim copy of today's parser (`parseLegacy`)
and evaluates that AST. `evaluate()` is the row-execution entry point for both `ComputeStep.apply`
(pipeline compute step) and `SourceService.applyComputedFields` (DataType computed fields) — both
keep producing pre-existing output for legacy expressions, zero user action, no data rewrite.
**Consequence (intentional):** `PipelineAnalyzeService.analyze` calls `validate()` (strict), so a
legacy bare-identifier compute step will show a `validationError` in the step-card UI even though
it keeps *running* correctly via `evaluate()`'s fallback — a soft-deprecation nudge, not a bug
(documented in Risks/Trade-offs so it isn't mistaken for a regression).
**DataTypeService boundary (resolves the scope-completeness gap):** `DataTypeService.applyUpdate`
hard-blocks the whole PATCH on any invalid computed-field expression (see Context) — if it called
strict `validate()`, every DataType with a legacy computed field would become un-updatable until
manually rewritten, an unplanned regression outside this ticket's charter. So
`DataTypeService.validateExpression`/`applyUpdate`'s `exprError` check switch to a new
`ExpressionEvaluator.validateTolerant` (same strict-first/`parseLegacy`-fallback shape as
`evaluate()`) instead of `validate()` — DataType computed-fields behavior stays bit-for-bit
unchanged; only the Compute pipeline step gets the stricter live-validation grammar. Follow-up
(not in this ticket): decide whether DataType computed fields should also require `$`.

**5. Output-type inference — replace the frontend-hardcoded `"number"` default; populate
`validationError` from the same strict parse.**
`inferCompute` currently reads `config.type` verbatim and never calls `ExpressionEvaluator` at all
(`parseConfig`'s try/catch only guards JSON-key extraction). Change it to: (a) call
`ExpressionEvaluator.validate(expression, inputSchema.map(_.name).toSet)` (strict) first — on
`Left(msg)`, set `AnalyzedStep.validationError = Some(msg)` and keep the wire `type` for the
output field; (b) on `Right(_)`, call new `ExpressionEvaluator.inferType(expr, fieldTypes:
Map[String, String]): Either[String, String]` (walks the same AST — no evaluation, just type
propagation: numeric ops → `"number"`; string literals/`concat`/`substring`/`lower`/`upper` →
`"string"`; `length` → `"number"`; field refs from `fieldTypes`; `+` with a string operand →
`"string"`) and use its result instead of the wire `type`. This is what makes Decision 4's
legacy-nudge `validationError` actually reach the frontend. `type` stays on the wire for
round-trip compat but becomes an informational fallback only (not removed from
`ComputeConfigValue` — out of scope churn).

**6. Error surfacing — read `validationError` now correctly populated by Decision 5.**
`ComputeFieldConfig` gains a `validationError?: string` prop; thread it down from
`useStepCardState`/`StepCard` the same way `analyzeColumns` is threaded today. Render as an
inline error row below the expression input using `frontend/src/shared/chrome/InlineError.tsx`
(already used by the sibling `AggregateConfig.tsx`).

## Risks / Trade-offs

- [Legacy compute steps show a `validationError` even though they still run] → intentional
  soft-deprecation nudge (Decision 4); documented in `pipeline-compute-op` spec scenarios.
- [Two extra fallback-aware entry points: `evaluate`, `validateTolerant`] → `parseLegacy` stays
  frozen/private with exactly those two call sites; removable once no legacy expressions remain.
- [`substring` clamps rather than throws on out-of-range] → judgment call, documented in the
  grammar doc; matches spreadsheet-function conventions (e.g. `MID`).
- [Frontend `type` field becomes vestigial] → left in place (non-breaking), follow-up cleanup.
- [DataType computed-fields keep accepting bare identifiers indefinitely] → explicitly out of
  scope; follow-up ticket if that feature later adopts `$`-required too.

## Migration Plan

No schema/data migration — deploy is a single backend + frontend release: ship
`ExpressionEvaluator`'s strict `parse()`/`validate()`, `parseLegacy` (private), `evaluate()`
(legacy fallback), and `validateTolerant()` (legacy fallback, `DataTypeService`-only) together
with `inferCompute`'s new wiring and `ComputeFieldConfig`'s error rendering, to keep apply/infer/UI
parity in one release. Rollback is a plain code revert — no data was ever rewritten.

## Planner Notes

- Self-approved: `substring` clamps out-of-range indices instead of throwing (ticket doesn't
  specify; consistent with the null-safe-per-row philosophy for range issues, while type
  mismatches stay hard errors).
- Self-approved: keeping the vestigial frontend `type` field rather than removing it from
  `ComputeConfigValue` — unrelated wire-shape churn outside this ticket's DoD.
- Self-approved: `compute-expression-language` as a new capability spec rather than folding the
  grammar into `pipeline-compute-op`, since the grammar is a reusable contract independent of the
  one op that currently consumes it.
- Self-approved: preserving `DataTypeService`'s bare-identifier-tolerant validation verbatim
  (`validateTolerant`) rather than tightening it — its save path hard-blocks on validation failure
  (unlike the pipeline compute step), so tightening it would be an unplanned breaking change to a
  feature outside this ticket's stated scope.
